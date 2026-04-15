import type { z } from "zod";

export function defineGroup(
	name: string,
	base: z.ZodObject<z.ZodRawShape>,
	children: Record<string, z.ZodObject<z.ZodRawShape>>,
) {
	const states: Record<string, z.ZodObject<z.ZodRawShape>> = {};
	const names: string[] = [];
	const accessors: Record<string, string> = {};

	for (const [childName, childSchema] of Object.entries(children)) {
		const fullName = `${name}.${childName}`;
		states[fullName] = base.merge(childSchema);
		names.push(fullName);
		accessors[childName] = fullName;
	}

	return Object.freeze({
		name,
		states: Object.freeze(states),
		names: Object.freeze(names),
		...accessors,
	});
}
