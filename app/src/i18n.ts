import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// the translations
const resources = {
  en: {
    translation: {
      "Welcome to Open Cowork": "Welcome to Open Cowork",
      "Cowork": "Cowork",
      "Settings": "Settings",
      "Artifacts": "Artifacts",
    }
  },
  de: {
    translation: {
      "Welcome to Open Cowork": "Willkommen bei Open Cowork",
      "Cowork": "Cowork",
      "Settings": "Einstellungen",
      "Artifacts": "Artefakte",
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "en", // default language
    fallbackLng: "en",
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;