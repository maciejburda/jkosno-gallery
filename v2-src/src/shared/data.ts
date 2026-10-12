/* Typed views over the shared v1 modules (assets/*.js) — one source of truth for both versions. */
import RAW from '../../../assets/data.js';
import * as i18n from '../../../assets/i18n.js';
import * as consent from '../../../assets/consent.js';

export interface Item {
  n: number;
  title: string;
  title_en?: string;
  full?: string;
  imgs: number[];
  w: number;          // cm
  h: number;          // cm
  measured: boolean;
  year?: string;
  support?: string;
  cat: string;
  group: string;
  tier?: string;
  sold?: boolean;
  soldInfo?: string;
  secret?: boolean;
}
export interface KosnoData { groups: string[]; items: Item[] }

export const KOSNO = RAW as unknown as KosnoData;

export type Lang = 'pl' | 'en';
export type T = (key: string, vars?: Record<string, string | number>) => string;

export const getLang = i18n.getLang as () => Lang;
export const setLang = i18n.setLang as (l: Lang) => void;
export const makeT = i18n.makeT as (l: Lang) => T;
export const tGroup = i18n.tGroup as (l: Lang, g: string) => string;
export const tCat = i18n.tCat as (l: Lang, c: string) => string;
export const tSup = i18n.tSup as (l: Lang, s: string) => string;
export const tTitle = i18n.tTitle as (l: Lang, it: Item) => string;

export const initConsentBanner = consent.initConsentBanner as (t: T) => void;
export const resetConsent = consent.resetConsent as (t: T) => void;

/* where the shared images live, relative to the v2 page (/v2/ → /assets/img/) */
export const IMG_BASE = '../assets/img/';
