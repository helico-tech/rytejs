import { DependencyErrorSignal } from "./types.js";

function createDepProxy<T extends object>(obj: T, depName: string): T {
	return new Proxy(obj, {
		get(target, prop, receiver) {
			if (typeof prop === "symbol") {
				return Reflect.get(target, prop, receiver);
			}

			const value = Reflect.get(target, prop, receiver);

			if (value === null || value === undefined) {
				return value;
			}

			if (typeof value === "function") {
				return (...args: unknown[]) => {
					try {
						const result = value.apply(target, args);
						if (result != null && typeof result === "object" && typeof result.then === "function") {
							return result.catch((err: unknown) => {
								throw new DependencyErrorSignal(depName, err);
							});
						}
						return result;
					} catch (err) {
						throw new DependencyErrorSignal(depName, err);
					}
				};
			}

			if (typeof value === "object") {
				return createDepProxy(value as object, depName);
			}

			return value;
		},
	});
}

/** Wraps a deps object in a recursive Proxy that catches dependency errors. */
export function wrapDeps<T extends object>(deps: T): T {
	return new Proxy(deps, {
		get(target, prop, receiver) {
			if (typeof prop === "symbol") {
				return Reflect.get(target, prop, receiver);
			}

			const value = Reflect.get(target, prop, receiver);

			if (value === null || value === undefined) {
				return value;
			}

			const depName = String(prop);

			if (typeof value === "function") {
				return (...args: unknown[]) => {
					try {
						const result = value.apply(target, args);
						if (result != null && typeof result === "object" && typeof result.then === "function") {
							return result.catch((err: unknown) => {
								throw new DependencyErrorSignal(depName, err);
							});
						}
						return result;
					} catch (err) {
						throw new DependencyErrorSignal(depName, err);
					}
				};
			}

			if (typeof value === "object") {
				return createDepProxy(value as object, depName);
			}

			return value;
		},
	});
}
