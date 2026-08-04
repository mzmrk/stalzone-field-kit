export type TranslatedText = {
  type?: string;
  key?: string;
  text?: string;
  lines?: Record<string, string>;
};

export type ListingEntry = {
  data: string;
  icon: string;
  name: TranslatedText;
  color: string;
  status?: { state?: string };
};

export type RawElement = {
  type?: string;
  name?: TranslatedText;
  key?: TranslatedText;
  value?: number | TranslatedText;
  min?: number;
  max?: number;
  formatted?: {
    value?: Record<string, string>;
    nameColor?: string;
    valueColor?: string;
  };
  [key: string]: unknown;
};

export type RawItem = {
  id: string;
  category: string;
  color: string;
  name: TranslatedText;
  infoBlocks: unknown[];
};

export type ParsedStat = {
  key: string;
  name: string;
  min: number;
  max: number;
  positive: boolean;
  percentage: boolean;
};

export type ContainerData = {
  entry: ListingEntry;
  item: RawItem;
  name: string;
  capacity: number;
  protection: number;
  effectiveness: number;
  weight: number;
  stats: ParsedStat[];
};

export type ArtifactData = {
  entry: ListingEntry;
  item: RawItem;
  name: string;
  weight: number;
  stats: ParsedStat[];
};

export type BonusProperty = {
  id: string;
  key: string;
  name: string;
  value: number;
  percentage: boolean;
};

export type ArtifactConfig = ArtifactData & {
  uid: string;
  level: number;
  quality: number;
  rarityIndex: number;
  bonuses: BonusProperty[];
};

export type TotalStat = {
  key: string;
  name: string;
  value: number;
  percentage: boolean;
  harmful: boolean;
};

export type PersistedBuild = {
  version: 1;
  container: ContainerData | null;
  artifacts: Array<ArtifactConfig | null>;
};
