import { ValueTransformer } from 'typeorm';

/**
 * TypeORM transformer for MySQL DATE columns.
 *
 * The MySQL driver returns DATE values as plain strings ('YYYY-MM-DD'); TypeORM
 * only auto-converts datetime/timestamp columns to Date objects. Without this
 * transformer, the declared `Date` type is a lie the compiler cannot catch, and
 * any caller that calls `.toISOString()` on the value crashes at runtime.
 *
 * Apply to every `@Column({ type: 'date' })` whose TypeScript type is `Date`.
 */
export const dateColumnTransformer: ValueTransformer = {
  /** Accept a Date or pre-formatted string on write; pass through unchanged. */
  to: (value: Date | string | null | undefined) => value,
  /** On read, convert the driver-returned string to a proper Date object. */
  from: (value: string | Date | null | undefined): Date | null | undefined => {
    if (value == null) return value as null | undefined;
    return value instanceof Date ? value : new Date(value);
  },
};
