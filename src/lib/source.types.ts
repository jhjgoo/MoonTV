export interface ConfigApiSite {
  name: string;
  api: string;
  detail?: string;
  adult?: boolean;
}

export interface ApiSite extends ConfigApiSite {
  key: string;
  adult: boolean;
}

export interface AdminSource extends ApiSite {
  from: 'config' | 'custom';
  disabled?: boolean;
}
