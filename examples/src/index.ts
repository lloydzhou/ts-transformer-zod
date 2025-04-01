import zobject from "ts-transformer-zod";

// 示例接口
interface User {
    id: number;
    name: string;
    email: string;
    age?: number;
    roles: string[];
    metadata: {
        createdAt: Date;
        active: boolean;
    };
}

// 使用 transformer 的 zobject 方法
const userSchema = zobject<User>();

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
