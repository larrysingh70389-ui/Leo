export function parseHttpsImageUrl(value, optionName) {
  if (!value) return undefined;
  if (value.length > 2048) throw new Error(`The ${optionName} cannot exceed 2,048 characters.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The ${optionName} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error(`The ${optionName} must be a valid HTTPS URL.`);
  }
  return url.toString();
}
