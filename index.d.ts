import * as z from "zod";
export * from "zod";

export type TypeToZod<T extends object> = z.ZodObject<{
    [K in keyof T]: T[K] extends string | number | boolean | null | undefined
        ? undefined extends T[K]
            ? z.ZodDefault<z.ZodType<Exclude<T[K], undefined>>>
            : z.ZodType<T[K]>
        : T[K] extends object
            ? z.ZodObject<TypeToZod<T[K]>['shape']> // Ensure the shape matches ZodRawShape
            : z.ZodArray<z.ZodType<T[K] extends any[] ? T[K][number] : never>>
}>

export function zobject<T extends object>(): TypeToZod<T>;
export default zobject;