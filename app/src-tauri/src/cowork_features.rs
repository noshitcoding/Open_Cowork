use crate::artifact_pipeline;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;
use zip::write::FileOptions;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentRequest {
    pub prompt: String,
    pub paths: Vec<String>,
    pub parallelism: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentItemResult {
    pub path: String,
    pub success: bool,
    pub summary: String,
    pub chars_processed: usize,
    pub duration_ms: u128,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubAgentRunResponse {
    pub prompt: String,
    pub parallelism: u8,
    pub total_items: usize,
    pub successful_items: usize,
    pub failed_items: usize,
    pub duration_ms: u128,
    pub results: Vec<SubAgentItemResult>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProOutputRequest {
    pub csv_path: String,
    pub output_dir: String,
    pub base_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProOutputResponse {
    pub csv_path: String,
    pub output_dir: String,
    pub generated_files: Vec<String>,
    pub rows: usize,
    pub columns: usize,
    pub numeric_columns: usize,
    pub totals: Vec<(String, f64)>,
}

#[derive(Debug, Clone)]
pub struct ArtifactVersionExportInput {
    pub artifact_version_id: String,
    pub run_id: Option<String>,
    pub label: Option<String>,
    pub source_path: String,
    pub source_format: String,
    pub source_size_bytes: i64,
    pub summary: String,
    pub preview: String,
    pub metadata: Value,
}

pub async fn run_sub_agents(request: SubAgentRequest, canonical_paths: Vec<PathBuf>) -> SubAgentRunResponse {
    let started = Instant::now();
    let parallelism = request.parallelism.unwrap_or(4).clamp(1, 12);
    let mut results = Vec::new();

    for chunk in canonical_paths.chunks(parallelism as usize) {
        let mut handles = Vec::new();
        for path in chunk {
            let path_for_worker = path.clone();
            handles.push(tauri::async_runtime::spawn_blocking(move || analyze_single_path(path_for_worker)));
        }

        for handle in handles {
            match handle.await {
                Ok(item) => results.push(item),
                Err(err) => results.push(SubAgentItemResult {
                    path: "unknown".to_string(),
                    success: false,
                    summary: "Sub-Agent fehlgeschlagen".to_string(),
                    chars_processed: 0,
                    duration_ms: 0,
                    error: Some(err.to_string()),
                }),
            }
        }
    }

    let successful_items = results.iter().filter(|item| item.success).count();
    let failed_items = results.len().saturating_sub(successful_items);

    SubAgentRunResponse {
        prompt: request.prompt,
        parallelism,
        total_items: results.len(),
        successful_items,
        failed_items,
        duration_ms: started.elapsed().as_millis(),
        results,
    }
}

fn analyze_single_path(path: PathBuf) -> SubAgentItemResult {
    let started = Instant::now();
    let path_display = path.display().to_string();

    let text_result = artifact_pipeline::extract_text_for_llm(path.as_path())
        .or_else(|_| artifact_pipeline::parse_artifact(path.as_path()).map(|parsed| parsed.preview));

    match text_result {
        Ok(text) => {
            let compact = text.replace('\n', " ").replace('\r', " ");
            let trimmed = compact.split_whitespace().collect::<Vec<_>>().join(" ");
            let preview: String = trimmed.chars().take(220).collect();
            let word_count = trimmed.split_whitespace().count();

            SubAgentItemResult {
                path: path_display,
                success: true,
                summary: format!("{} Woerter analysiert. Vorschau: {}", word_count, preview),
                chars_processed: trimmed.chars().count(),
                duration_ms: started.elapsed().as_millis(),
                error: None,
            }
        }
        Err(err) => SubAgentItemResult {
            path: path_display,
            success: false,
            summary: "Analyse fehlgeschlagen".to_string(),
            chars_processed: 0,
            duration_ms: started.elapsed().as_millis(),
            error: Some(err),
        },
    }
}

pub fn generate_pro_outputs(request: ProOutputRequest, csv_path: &Path, output_dir: &Path) -> Result<ProOutputResponse, String> {
    fs::create_dir_all(output_dir).map_err(|err| err.to_string())?;

    let (headers, rows) = parse_csv(csv_path)?;
    let totals = compute_numeric_totals(&headers, &rows);
    let base_name = sanitize_base_name(request.base_name.as_deref().unwrap_or("cowork_report"));

    let xlsx_path = output_dir.join(format!("{}_report.xlsx", base_name));
    let docx_path = output_dir.join(format!("{}_report.docx", base_name));
    let pptx_path = output_dir.join(format!("{}_report.pptx", base_name));
    let pdf_path = output_dir.join(format!("{}_report.pdf", base_name));

    write_xlsx(&xlsx_path, &headers, &rows, &totals)?;
    write_docx(&docx_path, &headers, rows.len(), &totals)?;
    write_pptx(&pptx_path, rows.len(), headers.len(), &totals)?;
    write_simple_pdf(&pdf_path, "Cowork Ergebnisreport", rows.len(), headers.len(), &totals)?;

    Ok(ProOutputResponse {
        csv_path: csv_path.display().to_string(),
        output_dir: output_dir.display().to_string(),
        generated_files: vec![
            xlsx_path.display().to_string(),
            docx_path.display().to_string(),
            pptx_path.display().to_string(),
            pdf_path.display().to_string(),
        ],
        rows: rows.len(),
        columns: headers.len(),
        numeric_columns: totals.len(),
        totals,
    })
}

pub fn export_artifact_version_native(
    target_path: &Path,
    export_format: &str,
    input: &ArtifactVersionExportInput,
) -> Result<(), String> {
    let field_rows = build_artifact_field_rows(input);
    let headers = vec!["Feld".to_string(), "Wert".to_string()];
    let totals = vec![("source_size_bytes".to_string(), input.source_size_bytes as f64)];

    match export_format {
        "xlsx" => write_xlsx(target_path, &headers, &field_rows, &totals),
        "docx" => {
            let mut doc_headers = headers.clone();
            doc_headers.push(format!("Summary: {}", input.summary));
            write_docx(target_path, &doc_headers, field_rows.len(), &totals)
        }
        "pptx" => write_pptx(target_path, field_rows.len(), headers.len(), &totals),
        "pdf" => {
            let title = format!(
                "Artefakt Export {} ({})",
                input.artifact_version_id,
                input.source_format
            );
            write_simple_pdf(target_path, &title, field_rows.len(), headers.len(), &totals)
        }
        _ => Err("unsupported native format".to_string()),
    }
}

fn build_artifact_field_rows(input: &ArtifactVersionExportInput) -> Vec<Vec<String>> {
    let mut rows = vec![
        vec!["artifact_version_id".to_string(), input.artifact_version_id.clone()],
        vec!["run_id".to_string(), input.run_id.clone().unwrap_or_else(|| "-".to_string())],
        vec!["label".to_string(), input.label.clone().unwrap_or_else(|| "-".to_string())],
        vec!["source_path".to_string(), input.source_path.clone()],
        vec!["source_format".to_string(), input.source_format.clone()],
        vec!["source_size_bytes".to_string(), input.source_size_bytes.to_string()],
        vec!["summary".to_string(), input.summary.clone()],
        vec!["preview".to_string(), input.preview.clone()],
    ];

    if let Some(metadata_map) = input.metadata.as_object() {
        for (key, value) in metadata_map {
            rows.push(vec![
                format!("metadata.{}", key),
                value.to_string(),
            ]);
        }
    }

    rows
}

fn sanitize_base_name(input: &str) -> String {
    let sanitized: String = input
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' })
        .collect();
    sanitized.trim_matches('_').to_string().chars().take(48).collect()
}

fn parse_csv(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let mut reader = csv::Reader::from_path(path).map_err(|err| err.to_string())?;
    let headers = reader
        .headers()
        .map_err(|err| err.to_string())?
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();

    let mut rows = Vec::new();
    for record in reader.records() {
        let record = record.map_err(|err| err.to_string())?;
        rows.push(record.iter().map(|value| value.to_string()).collect());
    }

    Ok((headers, rows))
}

fn compute_numeric_totals(headers: &[String], rows: &[Vec<String>]) -> Vec<(String, f64)> {
    let mut totals = Vec::new();
    for (index, header) in headers.iter().enumerate() {
        let mut sum = 0.0f64;
        let mut numeric_values = 0usize;
        for row in rows {
            if let Some(cell) = row.get(index) {
                let normalized = cell.trim().replace(',', ".");
                if let Ok(value) = normalized.parse::<f64>() {
                    sum += value;
                    numeric_values += 1;
                }
            }
        }

        if numeric_values > 0 {
            totals.push((header.clone(), sum));
        }
    }

    totals
}

fn write_xlsx(path: &Path, headers: &[String], rows: &[Vec<String>], totals: &[(String, f64)]) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|err| err.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options: FileOptions<'_, ()> = FileOptions::default();

    zip.start_file("[Content_Types].xml", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">
  <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>
  <Default Extension=\"xml\" ContentType=\"application/xml\"/>
  <Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>
  <Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>
  <Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>
</Types>"#).map_err(|err| err.to_string())?;

    zip.add_directory("_rels", options).map_err(|err| err.to_string())?;
    zip.start_file("_rels/.rels", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">
  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>
</Relationships>"#).map_err(|err| err.to_string())?;

    zip.add_directory("xl", options).map_err(|err| err.to_string())?;
    zip.add_directory("xl/_rels", options).map_err(|err| err.to_string())?;
    zip.add_directory("xl/worksheets", options).map_err(|err| err.to_string())?;

    zip.start_file("xl/workbook.xml", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">
  <sheets>
    <sheet name=\"Report\" sheetId=\"1\" r:id=\"rId1\"/>
  </sheets>
</workbook>"#).map_err(|err| err.to_string())?;

    zip.start_file("xl/_rels/workbook.xml.rels", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">
  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>
  <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>
</Relationships>"#).map_err(|err| err.to_string())?;

    zip.start_file("xl/styles.xml", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">
  <fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>
  <fills count=\"1\"><fill><patternFill patternType=\"none\"/></fill></fills>
  <borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>
  <cellXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/></cellXfs>
</styleSheet>"#).map_err(|err| err.to_string())?;

    let mut sheet = String::new();
    sheet.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    sheet.push_str("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>\n");

    sheet.push_str("<row r=\"1\">");
    for (idx, header) in headers.iter().enumerate() {
        let column = excel_column((idx + 1) as u32);
        sheet.push_str(&format!(
            "<c r=\"{}1\" t=\"inlineStr\"><is><t>{}</t></is></c>",
            column,
            xml_escape(header)
        ));
    }
    sheet.push_str("</row>\n");

    for (row_index, row) in rows.iter().enumerate() {
        let target_row = row_index + 2;
        sheet.push_str(&format!("<row r=\"{}\">", target_row));
        for (col_index, cell) in row.iter().enumerate() {
            let column = excel_column((col_index + 1) as u32);
            sheet.push_str(&format!(
                "<c r=\"{}{}\" t=\"inlineStr\"><is><t>{}</t></is></c>",
                column,
                target_row,
                xml_escape(cell)
            ));
        }
        sheet.push_str("</row>\n");
    }

    let totals_row = rows.len() + 3;
    if !totals.is_empty() {
        sheet.push_str(&format!("<row r=\"{}\">", totals_row));
        sheet.push_str(&format!(
            "<c r=\"A{}\" t=\"inlineStr\"><is><t>Summen</t></is></c>",
            totals_row
        ));
        for (idx, (name, value)) in totals.iter().enumerate() {
            let column = excel_column((idx + 2) as u32);
            sheet.push_str(&format!(
                "<c r=\"{}{}\" t=\"inlineStr\"><is><t>{}: {:.2}</t></is></c>",
                column,
                totals_row,
                xml_escape(name),
                value
            ));
        }
        sheet.push_str("</row>\n");
    }

    sheet.push_str("</sheetData></worksheet>");
    zip.start_file("xl/worksheets/sheet1.xml", options).map_err(|err| err.to_string())?;
    zip.write_all(sheet.as_bytes()).map_err(|err| err.to_string())?;

    zip.finish().map_err(|err| err.to_string())?;
    Ok(())
}

fn write_docx(path: &Path, headers: &[String], row_count: usize, totals: &[(String, f64)]) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|err| err.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options: FileOptions<'_, ()> = FileOptions::default();

    zip.start_file("[Content_Types].xml", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">
  <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>
  <Default Extension=\"xml\" ContentType=\"application/xml\"/>
  <Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>
</Types>"#).map_err(|err| err.to_string())?;

    zip.add_directory("_rels", options).map_err(|err| err.to_string())?;
    zip.start_file("_rels/.rels", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">
  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>
</Relationships>"#).map_err(|err| err.to_string())?;

    zip.add_directory("word", options).map_err(|err| err.to_string())?;
    let mut document = String::new();
    document.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    document.push_str("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>");
    document.push_str("<w:p><w:r><w:t>Cowork Report</w:t></w:r></w:p>");
    document.push_str(&format!(
        "<w:p><w:r><w:t>Datensaetze: {} | Spalten: {}</w:t></w:r></w:p>",
        row_count,
        headers.len()
    ));
    document.push_str(&format!(
        "<w:p><w:r><w:t>Spalten: {}</w:t></w:r></w:p>",
        xml_escape(&headers.join(", "))
    ));

    if totals.is_empty() {
        document.push_str("<w:p><w:r><w:t>Keine numerischen Summen erkannt.</w:t></w:r></w:p>");
    } else {
        document.push_str("<w:p><w:r><w:t>Summen:</w:t></w:r></w:p>");
        for (name, value) in totals {
            document.push_str(&format!(
                "<w:p><w:r><w:t>- {}: {:.2}</w:t></w:r></w:p>",
                xml_escape(name),
                value
            ));
        }
    }

    document.push_str("<w:sectPr/></w:body></w:document>");
    zip.start_file("word/document.xml", options).map_err(|err| err.to_string())?;
    zip.write_all(document.as_bytes()).map_err(|err| err.to_string())?;

    zip.finish().map_err(|err| err.to_string())?;
    Ok(())
}

fn write_pptx(path: &Path, row_count: usize, col_count: usize, totals: &[(String, f64)]) -> Result<(), String> {
    let file = fs::File::create(path).map_err(|err| err.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let options: FileOptions<'_, ()> = FileOptions::default();

    zip.start_file("[Content_Types].xml", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">
  <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>
  <Default Extension=\"xml\" ContentType=\"application/xml\"/>
  <Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>
  <Override PartName=\"/ppt/slides/slide1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>
</Types>"#).map_err(|err| err.to_string())?;

    zip.add_directory("_rels", options).map_err(|err| err.to_string())?;
    zip.start_file("_rels/.rels", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">
  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/>
</Relationships>"#).map_err(|err| err.to_string())?;

    zip.add_directory("ppt", options).map_err(|err| err.to_string())?;
    zip.add_directory("ppt/_rels", options).map_err(|err| err.to_string())?;
    zip.add_directory("ppt/slides", options).map_err(|err| err.to_string())?;
    zip.add_directory("ppt/slides/_rels", options).map_err(|err| err.to_string())?;

    zip.start_file("ppt/presentation.xml", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">
  <p:sldIdLst><p:sldId id=\"256\" r:id=\"rId1\"/></p:sldIdLst>
  <p:sldSz cx=\"9144000\" cy=\"6858000\" type=\"screen4x3\"/>
  <p:notesSz cx=\"6858000\" cy=\"9144000\"/>
</p:presentation>"#).map_err(|err| err.to_string())?;

    zip.start_file("ppt/_rels/presentation.xml.rels", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">
  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide1.xml\"/>
</Relationships>"#).map_err(|err| err.to_string())?;

    let mut slide_text = format!(
        "CSV Report | Datensaetze: {} | Spalten: {}",
        row_count, col_count
    );
    for (name, value) in totals.iter().take(6) {
        slide_text.push_str(&format!(" | {}: {:.2}", name, value));
    }

    zip.start_file("ppt/slides/slide1.xml", options).map_err(|err| err.to_string())?;
    let slide_xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id=\"2\" name=\"Title 1\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>",
        xml_escape(&slide_text)
    );
    zip.write_all(slide_xml.as_bytes()).map_err(|err| err.to_string())?;

    zip.start_file("ppt/slides/_rels/slide1.xml.rels", options).map_err(|err| err.to_string())?;
    zip.write_all(br#"<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>"#).map_err(|err| err.to_string())?;

    zip.finish().map_err(|err| err.to_string())?;
    Ok(())
}

fn write_simple_pdf(path: &Path, title: &str, row_count: usize, col_count: usize, totals: &[(String, f64)]) -> Result<(), String> {
    let mut lines = vec![
        title.to_string(),
        format!("Datensaetze: {}", row_count),
        format!("Spalten: {}", col_count),
    ];
    if totals.is_empty() {
        lines.push("Keine numerischen Summen erkannt".to_string());
    } else {
        lines.push("Summen:".to_string());
        for (name, value) in totals.iter().take(8) {
            lines.push(format!("{}: {:.2}", name, value));
        }
    }

    let mut text_stream = String::new();
    text_stream.push_str("BT /F1 12 Tf 50 780 Td 14 TL ");
    for (idx, line) in lines.iter().enumerate() {
        if idx > 0 {
            text_stream.push_str("T* ");
        }
        text_stream.push_str(&format!("({}) Tj ", pdf_escape(line)));
    }
    text_stream.push_str("ET");

    let objects = vec![
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n".to_string(),
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n".to_string(),
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n".to_string(),
        "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n".to_string(),
        format!(
            "5 0 obj << /Length {} >> stream\n{}\nendstream endobj\n",
            text_stream.len(),
            text_stream
        ),
    ];

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = vec![0usize];

    for object in &objects {
        offsets.push(pdf.len());
        pdf.push_str(object);
    }

    let xref_start = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", offsets.len()));
    pdf.push_str("0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.push_str(&format!("{:010} 00000 n \n", offset));
    }

    pdf.push_str(&format!(
        "trailer << /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF",
        offsets.len(),
        xref_start
    ));

    fs::write(path, pdf.as_bytes()).map_err(|err| err.to_string())
}

fn excel_column(index: u32) -> String {
    let mut n = index;
    let mut out = String::new();
    while n > 0 {
        let rem = ((n - 1) % 26) as u8;
        out.insert(0, (b'A' + rem) as char);
        n = (n - 1) / 26;
    }
    out
}

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn pdf_escape(input: &str) -> String {
    input.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)")
}