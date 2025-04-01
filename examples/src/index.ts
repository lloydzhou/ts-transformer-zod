import zobject from "ts-transformer-zod";

// 示例接口
interface User {
    name: string;
    age: number;
    isAdmin: boolean;
}

// 使用 transformer 的 zobject 方法
const userSchema = zobject<User>();

console.log("Generated Zod schema:", userSchema);

// // 测试用例
const validUser = {
    name: "Alice",
    age: 30,
    isAdmin: true,
};

const invalidUser = {
    name: "Alice",
    age: "30", // 错误：age 应为 number
    isAdmin: true,
};

console.log("Valid user validation:", userSchema.safeParse(validUser)); // 应通过
console.log("Invalid user validation:", userSchema.safeParse(invalidUser)); // 应失败
