const BIRTHDAY_PATTERNS = [
	/^\d{4}-(\d{2})-(\d{2})$/,
	/^\d{4}(\d{2})(\d{2})$/,
	/^--(\d{2})-?(\d{2})$/,
];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function occurrenceIn(year: number, month: number, day: number): Date {
	// 29 February in a non-leap year is celebrated on 1 March.
	if (month === 2 && day === 29 && !isLeapYear(year)) {
		return new Date(year, 2, 1);
	}
	return new Date(year, month - 1, day);
}

/**
 * The next occurrence (today included) of a birthday given as YYYY-MM-DD, YYYYMMDD, --MM-DD or --MMDD.
 * Anything else, or an invalid month/day, gives undefined.
 */
export function nextBirthday(value: string, today: Date): Date | undefined {
	const trimmed = value.trim();
	const match = BIRTHDAY_PATTERNS.map((pattern) => pattern.exec(trimmed)).find(Boolean);
	if (!match) return undefined;

	const month = Number(match[1]);
	const day = Number(match[2]);
	if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return undefined;

	const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const thisYear = occurrenceIn(startOfToday.getFullYear(), month, day);
	return thisYear >= startOfToday ? thisYear : occurrenceIn(startOfToday.getFullYear() + 1, month, day);
}

/**
 * Sort comparator: soonest upcoming birthday first, then unparseable values, then missing ones. Ties compare equal.
 */
export function compareBirthdays(a: string | undefined, b: string | undefined, today: Date): number {
	const rank = (value: string | undefined, date: Date | undefined) => (date ? 0 : value ? 1 : 2);
	const nextA = a ? nextBirthday(a, today) : undefined;
	const nextB = b ? nextBirthday(b, today) : undefined;
	const rankA = rank(a, nextA);
	const rankB = rank(b, nextB);

	if (rankA !== rankB) return rankA - rankB;
	if (nextA && nextB) return nextA.getTime() - nextB.getTime();
	return 0;
}
