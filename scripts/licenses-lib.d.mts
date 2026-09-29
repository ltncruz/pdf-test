export interface LicenseText { name: string; text: string; sha: string }
export interface CollectedPackage {
  key: string; name: string; version: string; license: string; scope: 'runtime' | 'dev'; requiredBy: string;
  licenseFiles: LicenseText[]; notices: LicenseText[];
}
export interface LicenseViolation { package: string; code: 'NOT_INSTALLED' | 'FORBIDDEN_DECLARED' | 'UNKNOWN_LICENSE' | 'NO_LICENSE_FILE' | 'FORBIDDEN_TEXT'; message: string }
export const ALLOWED: Set<string>;
export const FORBIDDEN_PATTERNS: { name: string; re: RegExp }[];
export function sha12(text: string): string;
export function scanForbiddenText(text: string): string[];
export function classifyDeclared(license: string): { status: 'ok' | 'unknown' | 'forbidden'; bad: string[] };
export function declaredLicense(pkg: unknown): string;
export function collectLicenses(projectRoot: string): {
  packages: CollectedPackage[]; violations: LicenseViolation[];
  missingOptional: { name: string; requiredBy: string }[]; noticeWarnings: string[];
};
