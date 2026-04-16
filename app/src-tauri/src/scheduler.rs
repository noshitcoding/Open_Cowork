use chrono::{DateTime, Datelike, Duration, Timelike, Utc, Weekday};

fn normalize(input: &str) -> String {
    input
        .trim()
        .to_lowercase()
        .replace('ä', "ae")
        .replace('ö', "oe")
        .replace('ü', "ue")
}

fn parse_time(value: &str) -> Result<(u32, u32), String> {
    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() != 2 {
        return Err("time must be HH:MM".to_string());
    }

    let hour = parts[0].parse::<u32>().map_err(|_| "invalid hour")?;
    let minute = parts[1].parse::<u32>().map_err(|_| "invalid minute")?;

    if hour > 23 || minute > 59 {
        return Err("time outside valid range".to_string());
    }

    Ok((hour, minute))
}

fn parse_weekday(value: &str) -> Option<Weekday> {
    match value {
        "montag" | "monday" => Some(Weekday::Mon),
        "dienstag" | "tuesday" => Some(Weekday::Tue),
        "mittwoch" | "wednesday" => Some(Weekday::Wed),
        "donnerstag" | "thursday" => Some(Weekday::Thu),
        "freitag" | "friday" => Some(Weekday::Fri),
        "samstag" | "saturday" => Some(Weekday::Sat),
        "sonntag" | "sunday" => Some(Weekday::Sun),
        _ => None,
    }
}

fn next_daily(now: DateTime<Utc>, hour: u32, minute: u32) -> DateTime<Utc> {
    let candidate = now
        .with_hour(hour)
        .and_then(|v| v.with_minute(minute))
        .and_then(|v| v.with_second(0))
        .and_then(|v| v.with_nanosecond(0));

    if let Some(value) = candidate {
        if value > now {
            return value;
        }
        return value + Duration::days(1);
    }

    now + Duration::days(1)
}

fn next_weekday(now: DateTime<Utc>, target_day: Weekday, hour: u32, minute: u32) -> DateTime<Utc> {
    let mut days_ahead = target_day.num_days_from_monday() as i64 - now.weekday().num_days_from_monday() as i64;
    if days_ahead < 0 {
        days_ahead += 7;
    }

    let base = now + Duration::days(days_ahead);
    let candidate = base
        .with_hour(hour)
        .and_then(|v| v.with_minute(minute))
        .and_then(|v| v.with_second(0))
        .and_then(|v| v.with_nanosecond(0));

    if let Some(value) = candidate {
        if value > now {
            return value;
        }
        return value + Duration::days(7);
    }

    now + Duration::days(7)
}

pub fn next_run_from_expression(expr: &str, now: DateTime<Utc>) -> Result<DateTime<Utc>, String> {
    let normalized = normalize(expr);

    if let Some(rest) = normalized.strip_prefix("every ") {
        if let Some(minutes_raw) = rest.strip_suffix(" min") {
            let minutes = minutes_raw.trim().parse::<i64>().map_err(|_| "invalid minute interval")?;
            if minutes < 1 || minutes > 1440 {
                return Err("minute interval must be between 1 and 1440".to_string());
            }
            return Ok(now + Duration::minutes(minutes));
        }
    }

    if let Some(rest) = normalized.strip_prefix("alle ") {
        if let Some(minutes_raw) = rest.strip_suffix(" min") {
            let minutes = minutes_raw.trim().parse::<i64>().map_err(|_| "invalid minute interval")?;
            if minutes < 1 || minutes > 1440 {
                return Err("minute interval must be between 1 and 1440".to_string());
            }
            return Ok(now + Duration::minutes(minutes));
        }
    }

    if let Some(rest) = normalized.strip_prefix("daily ") {
        let (hour, minute) = parse_time(rest)?;
        return Ok(next_daily(now, hour, minute));
    }

    if let Some(rest) = normalized.strip_prefix("taeglich ") {
        let (hour, minute) = parse_time(rest)?;
        return Ok(next_daily(now, hour, minute));
    }

    let parts: Vec<&str> = normalized.split_whitespace().collect();
    if parts.len() == 2 {
        if let Some(weekday) = parse_weekday(parts[0]) {
            let (hour, minute) = parse_time(parts[1])?;
            return Ok(next_weekday(now, weekday, hour, minute));
        }
    }

    Err("unsupported schedule expression".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_daily_expression() {
        let now = DateTime::parse_from_rfc3339("2026-04-16T09:00:00Z").unwrap().with_timezone(&Utc);
        let next = next_run_from_expression("daily 10:00", now).unwrap();
        assert_eq!(next.to_rfc3339(), "2026-04-16T10:00:00+00:00");
    }

    #[test]
    fn parses_weekday_expression() {
        let now = DateTime::parse_from_rfc3339("2026-04-16T09:00:00Z").unwrap().with_timezone(&Utc);
        let next = next_run_from_expression("montag 08:00", now).unwrap();
        assert_eq!(next.weekday(), Weekday::Mon);
    }
}
