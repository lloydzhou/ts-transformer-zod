import { z } from "zod";
// 使用 transformer 的 zobject 方法
const userSchema = z.object({
    id: z.number(),
    name: z.string(),
    email: z.string(),
    age: z.number(),
    roles: z.any(),
    metadata: z.any()
});
// 使用模式验证数据
const userData = {
    id: 1,
    name: "张三",
    email: "zhangsan@example.com",
    age: 30,
    roles: ["admin"],
    metadata: {
        createdAt: new Date(),
        active: true
    }
};
console.log("Valid user validation:", userSchema.safeParse(userData)); // 应通过
