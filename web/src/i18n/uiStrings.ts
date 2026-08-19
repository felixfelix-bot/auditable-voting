import { type LocalisedText, type SupportedLocale } from "./types";

/**
 * All UI string keys used in the app.
 * Each key maps to a LocalisedText with at least `en` defined.
 * Add new keys here as features are translated.
 *
 * This is the initial set; F1-T4 will expand it with full translations.
 */
export const UI_STRINGS = {
  // ── Role labels ──────────────────────────────────────────────────
  roleVoter: { en: "Voter", fr: "Électeur", ta: "வாக்காளர்" },
  roleOrganiser: { en: "Organiser", fr: "Organisateur", ta: "ஒருங்கிணைப்பாளர்" },
  roleObserver: { en: "Observer", fr: "Observateur", ta: "பார்வையாளர்" },

  // ── Tab labels ───────────────────────────────────────────────────
  tabFindOrganiser: { en: "Find organiser", fr: "Trouver un organisateur", ta: "ஒருங்கிணைப்பாளரைக் கண்டுபிடி" },
  tabVote: { en: "Vote", fr: "Voter", ta: "வாக்களி" },
  tabMessages: { en: "Messages", fr: "Messages", ta: "செய்திகள்" },
  tabSettings: { en: "Settings", fr: "Paramètres", ta: "அமைப்புகள்" },

  // ── Action buttons ───────────────────────────────────────────────
  actionSubmit: { en: "Submit", fr: "Soumettre", ta: "சமர்ப்பிக்க" },
  actionCancel: { en: "Cancel", fr: "Annuler", ta: "ரத்துசெய்" },
  actionPublish: { en: "Publish", fr: "Publier", ta: "வெளியிடு" },
  actionSave: { en: "Save", fr: "Enregistrer", ta: "சேமி" },
  actionClose: { en: "Close", fr: "Fermer", ta: "மூடு" },
  actionRetry: { en: "Retry", fr: "Réessayer", ta: "மீண்டும் முயற்சி" },

  // ── Question types ───────────────────────────────────────────────
  questionTypeYesNo: { en: "Yes / No", fr: "Oui / Non", ta: "ஆம் / இல்லை" },
  questionTypeMultipleChoice: { en: "Multiple choice", fr: "Choix multiple", ta: "பல தேர்வு" },
  questionTypeRank: { en: "Rank", fr: "Classement", ta: "தரவரிசை" },
  questionTypeFreeText: { en: "Free text", fr: "Texte libre", ta: "கட்டற்ற உரை" },

  // ── Status messages ──────────────────────────────────────────────
  statusComplete: { en: "Complete", fr: "Terminé", ta: "முடிந்தது" },
  statusPending: { en: "Pending", fr: "En attente", ta: "நிலுவையில்" },
  statusOptional: { en: "Optional", fr: "Optionnel", ta: "விருப்பத்தேர்வு" },

  // ── Language switcher ────────────────────────────────────────────
  languageLabel: { en: "Language", fr: "Langue", ta: "மொழி" },
  languageEnglish: { en: "English", fr: "Anglais", ta: "ஆங்கிலம்" },
  languageFrench: { en: "French", fr: "Français", ta: "பிரெஞ்சு" },
  languageTamil: { en: "Tamil", fr: "Tamoul", ta: "தமிழ்" },

  // ── Theme ────────────────────────────────────────────────────────
  themeToggle: { en: "Toggle theme", fr: "Changer de thème", ta: "தீம் மாற்று" },
} as const satisfies Record<string, LocalisedText>;

export type UiStringKey = keyof typeof UI_STRINGS;

/**
 * Look up a UI string for a given locale.
 * @param key - Key from UI_STRINGS
 * @param locale - Requested locale (falls back to en)
 * @returns Resolved string
 */
export function t(key: UiStringKey, locale: SupportedLocale): string {
  const entry = UI_STRINGS[key];
  if (!entry) {
    return key; // graceful degradation for missing keys
  }
  return resolveLocalisedText(entry, locale);
}

// Import inline to avoid circular deps with index.ts
import { resolveLocalised } from "./resolveLocale";

function resolveLocalisedText(text: LocalisedText, locale: SupportedLocale): string {
  return resolveLocalised(text, locale);
}