# ts-transformer-zod

[![npm version](https://badge.fury.io/js/ts-transformer-zod.svg)](https://badge.fury.io/js/ts-transformer-zod)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

一个TypeScript自定义转换器（transformer），用于从TypeScript类型自动生成[Zod](https://github.com/colinhacks/zod)验证模式。

## 特性

- 从TypeScript接口和类型生成Zod模式
- 支持基本类型、字面量、数组、元组、对象、联合类型、交叉类型等
- 与TypeScript的类型系统完全兼容
- 在编译时自动生成模式，无需运行时开销

## 安装

```bash
<yarn|npm|pnpm> add -D ts-transformer-zod
```

## 使用方法

### 通过 ts-patch 使用

1. 安装 ts-patch：

```bash
<yarn|npm|pnpm> add -D ts-patch

ts-patch install
```

2. 在 `tsconfig.json` 中配置转换器：

```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "ts-transformer-zod/transformer" }
    ]
  }
}
```

3. 使用 ttypescript 编译你的代码：

```bash
<yarn|npm|pnpm> tspc
```

### 代码示例

```typescript
import { zobject } from 'ts-transformer-zod';

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

// 自动生成的Zod模式
const userSchema = zobject<User>();

// 使用模式验证数据
const userData = userSchema.parse({
  id: 1,
  name: "张三",
  email: "zhangsan@example.com",
  roles: ["admin"],
  metadata: {
    createdAt: new Date(),
    active: true
  }
});
```

### 支持的类型

- 基本类型：`string`, `number`, `boolean`, `null`, `undefined`, `any`, `unknown`
- 字面量类型：`"hello"`, `42`, `true`
- 数组：`string[]`, `Array<number>`
- 元组：`[string, number]`
- 对象/接口：包括嵌套属性
- 联合类型：`string | number`
- 交叉类型：`A & B`
- 可选属性：`{ prop?: string }`
- 日期：`Date`
- 记录类型：`Record<string, number>`

## 配置选项

在 `tsconfig.json` 中你可以提供额外的配置选项：

```json
{
  "compilerOptions": {
    "plugins": [
      { "transform": "ts-transformer-zod/transformer" }
    ]
  }
}
```

## 许可证

MIT
