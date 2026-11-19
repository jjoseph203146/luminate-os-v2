// Lets `node --experimental-strip-types --import ./scripts/ts-alias-register.mjs` load this repo's
// TypeScript, including `@/` paths. Used only by local scripts. The Next.js app does not use it.
const { URL } = globalThis;
const SRC = new URL("../src/", import.meta.url);

function withExt(specifier) {
  if (/\.(ts|js|mjs|cjs|json|node)$/.test(specifier)) return specifier;
  return `${specifier}.ts`;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const abs = new URL(withExt(specifier.slice(2)), SRC).href;
    return nextResolve(abs, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.(ts|js|mjs|cjs|json|node)$/.test(specifier)) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      return nextResolve(withExt(specifier), context);
    }
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // Node requires an extension for packages that ship files without an exports map (Next does).
    if (!specifier.startsWith(".") && !specifier.startsWith("@/") && !specifier.endsWith(".js")) {
      try {
        return await nextResolve(`${specifier}.js`, context);
      } catch {
        throw error;
      }
    }
    throw error;
  }
}
