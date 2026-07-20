import type { AdminSource, ConfigApiSite } from './source.types';

type SourceInput = Omit<AdminSource, 'adult'> & { adult?: unknown };

export function normalizeAdminSource(input: SourceInput): AdminSource {
  return {
    ...input,
    key: input.key.trim(),
    name: input.name.trim(),
    api: input.api.trim(),
    detail: input.detail?.trim() || undefined,
    adult: input.adult === true,
    disabled: input.disabled === true,
  };
}

export function normalizeConfigSource(
  key: string,
  input: ConfigApiSite
): AdminSource {
  return normalizeAdminSource({
    key,
    name: input.name,
    api: input.api,
    detail: input.detail,
    adult: input.adult,
    from: 'config',
    disabled: false,
  });
}
