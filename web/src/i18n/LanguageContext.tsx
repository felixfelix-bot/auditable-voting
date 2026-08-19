import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { type SupportedLocale } from "./types";
import { detectLocale, LOCALE_STORAGE_KEY } from "./resolveLocale";

/**
 * Context value provided by LanguageProvider.
 */
interface LanguageContextValue {
  /** Current locale */
  locale: SupportedLocale;
  /** Change the locale and persist to localStorage */
  setLocale: (locale: SupportedLocale) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

interface LanguageProviderProps {
  children: ReactNode;
  /** Override initial locale (primarily for testing) */
  initialLocale?: SupportedLocale;
}

/**
 * React context provider that manages the current locale and persists
 * user preferences to localStorage (key: `av-locale`).
 */
export function LanguageProvider({
  children,
  initialLocale,
}: LanguageProviderProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(
    () => initialLocale ?? detectLocale(),
  );

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    } catch {
      // localStorage unavailable; locale is still set in state.
    }
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * Hook to access the current language context.
 * Must be used within a `<LanguageProvider>`.
 */
export function useLocale(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLocale must be used within a LanguageProvider");
  }
  return ctx;
}