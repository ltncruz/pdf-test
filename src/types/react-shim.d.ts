/**
 * TEMPORÁRIO: @types/react não pôde ser instalado neste ambiente (registro npm bloqueado).
 * Este shim tipa só o que a UI usa, de forma frouxa (props/eventos como `any`), para que o
 * typecheck ainda valide o uso da API do core. Remover quando `@types/react` e `@types/react-dom`
 * forem instalados (e ter as licenças registradas em THIRD_PARTY_LICENSES.md).
 */
declare module 'react' {
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initial: T): { current: T };
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useSyncExternalStore<T>(subscribe: (listener: () => void) => () => void, getSnapshot: () => T): T;
  export function StrictMode(props: { children?: unknown }): {};
}
declare module 'react-dom/client' {
  export function createRoot(container: Element): { render(node: unknown): void };
}
declare module 'react/jsx-runtime' {
  export const jsx: unknown;
  export const jsxs: unknown;
  export const Fragment: unknown;
  export namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interface IntrinsicElements { [tag: string]: any }
    interface Element {}
    interface IntrinsicAttributes { key?: string | number | null }
    interface ElementChildrenAttribute { children: {} }
  }
}
