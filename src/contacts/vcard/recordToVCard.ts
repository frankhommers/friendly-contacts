import { parseKey } from "src/contacts/contactDataKeys";
import { StructuredFields } from "src/contacts/vcard/shared/structuredFields";

function filterNonNull<T>(array: (T | null | undefined)[]): T[] {
	return array.filter((item): item is T => item !== null && item !== undefined);
}

function renderStructuredLines(structuredFields:[string, string][]):string[] {
	const fields =  Object.fromEntries(structuredFields);
	const partialKeys = structuredFields
		.map(([key]) => key.includes('.') ? key.split('.')[0] : null);
	const uniqueKeys = [...new Set(filterNonNull(partialKeys))];

	const structuredLines = uniqueKeys.map((key) => {
		const keyObj = parseKey(key);
		const type = keyObj.type ? `;TYPE=${keyObj.type}` : '';
		switch (keyObj.key) {
			case 'N': {
				return `N${type}:${StructuredFields.N.map(field => fields[key + '.' + field] || "").join(";")}`;
			}
			case 'ADR': {
				return `ADR${type}:${StructuredFields.ADR.map(field => fields[key + '.' + field] || "").join(";")}`;
			}
			default: {
				return '';
			}
		}
	})

	return structuredLines.filter((line) => line !== '');
}

function renderSingleKey([key, value]:[string, string]):string  {
  const keyObj = parseKey(key);
	const type = keyObj.type ? `;TYPE=${keyObj.type}` : '';
	return `${keyObj.key}${type}:${value}`;
}

/**
 * A `TEL[CELL]`-style record (an old-style note) -> vCard text.
 * Without FN, `fallbackFn` (the file name) is used.
 */
export function recordToVCard(record: Record<string, string>, fallbackFn: string): string {
  const singleLineFields: Array<[string, string]> = [];
  const structuredFields: Array<[string, string]> = [];

  Object.entries(record).forEach(([key, value]) => {
    const keyObj = parseKey(key);

    if (['ADR', 'N'].includes(keyObj.key)) {
      structuredFields.push([key, value]);
    } else {
      singleLineFields.push([key, value]);
    }
  });

  if (!singleLineFields.some(([key]) => key === 'FN')) {
    singleLineFields.push(['FN', fallbackFn]);
  }

  const structuredLines = renderStructuredLines(structuredFields);
  const singleLines = singleLineFields.map(renderSingleKey);
  const lines = structuredLines.concat(singleLines);

  return `BEGIN:VCARD\n${lines.join("\n")}\nEND:VCARD`;
}
