import { useTranslation } from 'react-i18next';

export default function ArtifactsView() {
  const { t } = useTranslation();
  return (
    <div className='p-4'>
      <h1>{t("Artifacts")}</h1>
    </div>
  );
}