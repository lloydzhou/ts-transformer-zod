"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOptionalType = isOptionalType;
exports.getBaseTypeFromOptional = getBaseTypeFromOptional;
exports.default = transformer;
const ts = __importStar(require("typescript"));
const path = __importStar(require("path"));
const zod_1 = require("zod");
// @ts-ignore
globalThis.z = zod_1.z; // 确保 z 在全局范围内可用
const indexJs = path.join(__dirname, 'index.js');
function isZObjectImportExpression(node) {
    if (!ts.isImportDeclaration(node)) {
        return false;
    }
    const module = node.moduleSpecifier.text;
    try {
        return indexJs === (module.startsWith('.')
            ? require.resolve(path.resolve(path.dirname(node.getSourceFile().fileName), module))
            : require.resolve(module));
    }
    catch (e) {
        return false;
    }
}
const indexTs = path.join(__dirname, 'index.d.ts');
function isZObjectCallExpression(node, typeChecker) {
    if (!ts.isCallExpression(node)) {
        return false;
    }
    const declaration = typeChecker.getResolvedSignature(node)?.declaration;
    if (!declaration || ts.isJSDocSignature(declaration) || declaration.name?.getText() !== 'zobject') {
        return false;
    }
    try {
        // require.resolve is required to resolve symlink.
        // https://github.com/kimamula/ts-transformer-keys/issues/4#issuecomment-643734716
        return require.resolve(declaration.getSourceFile().fileName) === indexTs;
    }
    catch {
        // declaration.getSourceFile().fileName may not be in Node.js require stack and require.resolve may result in an error.
        // https://github.com/kimamula/ts-transformer-keys/issues/47
        return false;
    }
}
function isOptionalType(type, typeChecker, symbol) {
    // 检查是否是联合类型且包含 undefined
    if (type.flags & ts.TypeFlags.Union) {
        const unionType = type;
        // 检查联合类型的各部分是否包含 undefined
        for (const t of unionType.types) {
            if (t.flags & ts.TypeFlags.Undefined) {
                return true;
            }
        }
    }
    // 检查符号是否标记为可选 (通过问号修饰符)
    if (symbol && (symbol.flags & ts.SymbolFlags.Optional)) {
        return true;
    }
    return false;
}
function getBaseTypeFromOptional(type, typeChecker) {
    if (isOptionalType(type, typeChecker)) {
        return typeChecker.getNonNullableType(type);
    }
    return type;
}
function transformer(program) {
    // @ts-ignore
    return (context) => {
        const factory = context.factory || ts.factory; // 向前兼容处理
        return (sourceFile) => {
            const typeChecker = program.getTypeChecker();
            let needsZodImport = false;
            function visit(node) {
                if (isZObjectImportExpression(node)) {
                    // @ts-ignore
                    return;
                }
                if (isZObjectCallExpression(node, typeChecker)) {
                    // 标记需要导入zod
                    needsZodImport = true;
                    const typeArgument = node.typeArguments?.[0];
                    if (typeArgument && ts.isTypeNode(typeArgument)) {
                        const type = typeChecker.getTypeFromTypeNode(typeArgument);
                        const zodSchema = generateZodSchema(type);
                        return zodSchema; // 替换为生成的 Zod schema
                    }
                }
                return ts.visitEachChild(node, visit, context);
            }
            function generateZodSchema(type) {
                const properties = type.getProperties();
                const zodObjectProperties = properties.map((property) => {
                    const propertyName = property.getName();
                    const propertyType = typeChecker.getTypeOfSymbolAtLocation(property, property.valueDeclaration);
                    // 传递属性符号以正确检测可选性
                    const zodType = mapTypeToZod(propertyType, property);
                    return factory.createPropertyAssignment(propertyName, zodType);
                });
                return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("object")), undefined, [factory.createObjectLiteralExpression(zodObjectProperties, true)]);
            }
            function mapTypeToZod(type, symbol) {
                // 处理可选类型，传递符号以检测问号修饰符
                const isOptional = isOptionalType(type, typeChecker, symbol);
                let baseType = isOptional ? getBaseTypeFromOptional(type, typeChecker) : type;
                let zodExpr;
                // 处理字面量类型
                if (baseType.isStringLiteral()) {
                    const value = baseType.value;
                    zodExpr = createZodLiteral(value);
                }
                else if (baseType.isNumberLiteral()) {
                    const value = baseType.value;
                    zodExpr = createZodLiteral(value);
                }
                else if (baseType.flags & ts.TypeFlags.BooleanLiteral) {
                    const intrinsicName = (baseType.intrinsicName || '').toLowerCase();
                    const value = intrinsicName === 'true';
                    zodExpr = createZodLiteral(value);
                }
                // 处理基本类型
                else if (baseType.flags & ts.TypeFlags.String) {
                    zodExpr = createZodType("string");
                }
                else if (baseType.flags & ts.TypeFlags.Number) {
                    zodExpr = createZodType("number");
                }
                else if (baseType.flags & ts.TypeFlags.Boolean) {
                    zodExpr = createZodType("boolean");
                }
                else if (baseType.flags & ts.TypeFlags.Null) {
                    zodExpr = createZodType("null");
                }
                else if (baseType.flags & ts.TypeFlags.Undefined) {
                    zodExpr = createZodType("undefined");
                }
                // 处理日期类型
                else if (isDateType(baseType)) {
                    zodExpr = createZodType("date");
                }
                // 处理数组类型
                else if (typeChecker.isArrayType(baseType)) {
                    const elementType = getArrayElementType(baseType);
                    zodExpr = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("array")), undefined, [mapTypeToZod(elementType)]);
                }
                // 处理元组类型
                else if (isTupleType(baseType)) {
                    const tupleTypes = getTupleElementTypes(baseType);
                    const tupleElementsZod = tupleTypes.map(t => mapTypeToZod(t));
                    zodExpr = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("tuple")), undefined, [factory.createArrayLiteralExpression(tupleElementsZod, true)]);
                }
                // 处理枚举类型
                else if (baseType.flags & ts.TypeFlags.Enum || baseType.flags & ts.TypeFlags.EnumLiteral) {
                    zodExpr = createZodEnum(baseType);
                }
                // 处理联合类型
                else if (baseType.isUnion()) {
                    const unionTypes = baseType.types.map(t => mapTypeToZod(t));
                    zodExpr = factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("union")), undefined, [factory.createArrayLiteralExpression(unionTypes, true)]);
                }
                // 处理对象/接口/类类型
                else if (baseType.isClassOrInterface() || baseType.getProperties().length > 0) {
                    zodExpr = generateZodSchema(baseType);
                }
                // 默认处理为 any
                else {
                    zodExpr = createZodType("any");
                }
                // 如果是可选类型，添加 .optional()
                if (isOptional) {
                    zodExpr = factory.createCallExpression(factory.createPropertyAccessExpression(zodExpr, factory.createIdentifier("optional")), undefined, []);
                }
                return zodExpr;
            }
            // 辅助函数：创建基本的 zod 类型
            function createZodType(typeName) {
                return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier(typeName)), undefined, []);
            }
            // 辅助函数：创建 zod 字面量类型
            function createZodLiteral(value) {
                let literalValue;
                if (typeof value === "string") {
                    literalValue = factory.createStringLiteral(value);
                }
                else if (typeof value === "number") {
                    literalValue = factory.createNumericLiteral(value);
                }
                else {
                    literalValue = value ? factory.createTrue() : factory.createFalse();
                }
                return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("literal")), undefined, [literalValue]);
            }
            // 辅助函数：创建 zod 枚举类型
            function createZodEnum(type) {
                const enumMembers = [];
                const symbol = type.getSymbol();
                if (symbol && symbol.exports) {
                    symbol.exports.forEach((_, key) => {
                        enumMembers.push(key.toString());
                    });
                }
                return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("enum")), undefined, [factory.createArrayLiteralExpression(enumMembers.map(member => factory.createStringLiteral(member)), true)]);
            }
            // 判断类型是否为日期类型
            function isDateType(type) {
                const symbol = type.getSymbol();
                return !!symbol && symbol.getName() === "Date";
            }
            // 获取数组元素类型
            function getArrayElementType(type) {
                return type.typeArguments?.[0] || typeChecker.getAnyType();
            }
            // 判断类型是否为元组类型
            function isTupleType(type) {
                return !!(type.flags & ts.TypeFlags.Object) &&
                    !!(type.objectFlags & ts.ObjectFlags.Tuple);
            }
            // 获取元组元素类型
            function getTupleElementTypes(type) {
                return type.typeArguments || [];
            }
            const resultFile = ts.visitNode(sourceFile, visit);
            // 过滤掉被标记为删除的语句（即返回undefined的语句）
            const filteredStatements = resultFile.statements.filter(statement => statement !== undefined);
            // 如果检测到了zobject调用，添加zod导入语句
            if (needsZodImport) {
                const importStatement = factory.createImportDeclaration(undefined, factory.createImportClause(false, undefined, factory.createNamedImports([
                    factory.createImportSpecifier(false, undefined, factory.createIdentifier("z"))
                ])), factory.createStringLiteral("zod"), undefined);
                filteredStatements.unshift(importStatement);
            }
            // 如果没有检测到zobject调用但有被过滤的语句，更新源文件
            return factory.updateSourceFile(resultFile, filteredStatements, resultFile.isDeclarationFile, resultFile.referencedFiles, resultFile.typeReferenceDirectives, resultFile.hasNoDefaultLib, resultFile.libReferenceDirectives);
            return resultFile;
        };
    };
}
