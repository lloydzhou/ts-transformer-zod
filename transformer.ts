import * as ts from "typescript";
import * as path from "path";
import { z } from "zod";

// @ts-ignore
globalThis.z = z; // 确保 z 在全局范围内可用

const indexJs = path.join(__dirname, 'index.js');
function isZObjectImportExpression(node: ts.Node): node is ts.ImportDeclaration {
  if (!ts.isImportDeclaration(node)) {
    return false;
  }
  const module = (node.moduleSpecifier as ts.StringLiteral).text;
  try {
    return indexJs === (
      module.startsWith('.')
        ? require.resolve(path.resolve(path.dirname(node.getSourceFile().fileName), module))
        : require.resolve(module)
    );
  } catch(e) {
    return false;
  }
}

const indexTs = path.join(__dirname, 'index.d.ts');
function isZObjectCallExpression(node: ts.Node, typeChecker: ts.TypeChecker): node is ts.CallExpression {
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
  } catch {
    // declaration.getSourceFile().fileName may not be in Node.js require stack and require.resolve may result in an error.
    // https://github.com/kimamula/ts-transformer-keys/issues/47
    return false;
  }
}

export function isOptionalType(type: ts.Type, typeChecker: ts.TypeChecker, symbol?: ts.Symbol): boolean {
  // 检查是否是联合类型且包含 undefined
  if (type.flags & ts.TypeFlags.Union) {
    const unionType = type as ts.UnionType;
    
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

export function getBaseTypeFromOptional(type: ts.Type, typeChecker: ts.TypeChecker): ts.Type {
  if (isOptionalType(type, typeChecker)) {
    return typeChecker.getNonNullableType(type);
  }
  
  return type;
}

export default function transformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
    // @ts-ignore
    return (context: ts.TransformationContext) => {
        const factory = context.factory || ts.factory; // 向前兼容处理
        return (sourceFile: ts.SourceFile) => {
            const typeChecker = program.getTypeChecker();
            let needsZodImport = false;

            function visit(node: ts.Node): ts.Node {
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

            function generateZodSchema(type: ts.Type): ts.Expression {
                const properties = type.getProperties();
                const zodObjectProperties: ts.ObjectLiteralElementLike[] = properties.map((property) => {
                    const propertyName = property.getName();
                    const propertyType = typeChecker.getTypeOfSymbolAtLocation(property, property.valueDeclaration!);
                    // 传递属性符号以正确检测可选性
                    const zodType = mapTypeToZod(propertyType, property);
                    return factory.createPropertyAssignment(propertyName, zodType);
                });

                return factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                        factory.createIdentifier("z"),
                        factory.createIdentifier("object")
                    ),
                    undefined,
                    [factory.createObjectLiteralExpression(zodObjectProperties, true)]
                );
            }

            function mapTypeToZod(type: ts.Type, symbol?: ts.Symbol): ts.Expression {
                // 处理可选类型，传递符号以检测问号修饰符
                const isOptional = isOptionalType(type, typeChecker, symbol);
                let baseType = isOptional ? getBaseTypeFromOptional(type, typeChecker) : type;
                
                let zodExpr: ts.Expression;
                
                // 处理字面量类型
                if (baseType.isStringLiteral()) {
                    const value = (baseType as ts.StringLiteralType).value;
                    zodExpr = createZodLiteral(value);
                } else if (baseType.isNumberLiteral()) {
                    const value = (baseType as ts.NumberLiteralType).value;
                    zodExpr = createZodLiteral(value);
                } else if (baseType.flags & ts.TypeFlags.BooleanLiteral) {
                    const intrinsicName = ((baseType as any).intrinsicName || '').toLowerCase();
                    const value = intrinsicName === 'true';
                    zodExpr = createZodLiteral(value);
                } 
                // 处理基本类型
                else if (baseType.flags & ts.TypeFlags.String) {
                    zodExpr = createZodType("string");
                } else if (baseType.flags & ts.TypeFlags.Number) {
                    zodExpr = createZodType("number");
                } else if (baseType.flags & ts.TypeFlags.Boolean) {
                    zodExpr = createZodType("boolean");
                } else if (baseType.flags & ts.TypeFlags.Null) {
                    zodExpr = createZodType("null");
                } else if (baseType.flags & ts.TypeFlags.Undefined) {
                    zodExpr = createZodType("undefined");
                } 
                // 处理日期类型
                else if (isDateType(baseType)) {
                    zodExpr = createZodType("date");
                } 
                // 处理数组类型
                else if (typeChecker.isArrayType(baseType)) {
                    const elementType = getArrayElementType(baseType);
                    zodExpr = factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                            factory.createIdentifier("z"),
                            factory.createIdentifier("array")
                        ),
                        undefined,
                        [mapTypeToZod(elementType)]
                    );
                } 
                // 处理元组类型
                else if (isTupleType(baseType)) {
                    const tupleTypes = getTupleElementTypes(baseType);
                    const tupleElementsZod = tupleTypes.map(t => mapTypeToZod(t));
                    zodExpr = factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                            factory.createIdentifier("z"),
                            factory.createIdentifier("tuple")
                        ),
                        undefined,
                        [factory.createArrayLiteralExpression(tupleElementsZod, true)]
                    );
                } 
                // 处理枚举类型
                else if (baseType.flags & ts.TypeFlags.Enum || baseType.flags & ts.TypeFlags.EnumLiteral) {
                    zodExpr = createZodEnum(baseType);
                } 
                // 处理联合类型
                else if (baseType.isUnion()) {
                    const unionTypes = (baseType as ts.UnionType).types.map(t => mapTypeToZod(t));
                    zodExpr = factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                            factory.createIdentifier("z"),
                            factory.createIdentifier("union")
                        ),
                        undefined,
                        [factory.createArrayLiteralExpression(unionTypes, true)]
                    );
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
                    zodExpr = factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                            zodExpr,
                            factory.createIdentifier("optional")
                        ),
                        undefined,
                        []
                    );
                }
                
                return zodExpr;
            }

            // 辅助函数：创建基本的 zod 类型
            function createZodType(typeName: string): ts.Expression {
                return factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                        factory.createIdentifier("z"),
                        factory.createIdentifier(typeName)
                    ),
                    undefined,
                    []
                );
            }

            // 辅助函数：创建 zod 字面量类型
            function createZodLiteral(value: string | number | boolean): ts.Expression {
                let literalValue: ts.Expression;
                if (typeof value === "string") {
                    literalValue = factory.createStringLiteral(value);
                } else if (typeof value === "number") {
                    literalValue = factory.createNumericLiteral(value);
                } else {
                    literalValue = value ? factory.createTrue() : factory.createFalse();
                }
                
                return factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                        factory.createIdentifier("z"),
                        factory.createIdentifier("literal")
                    ),
                    undefined,
                    [literalValue]
                );
            }

            // 辅助函数：创建 zod 枚举类型
            function createZodEnum(type: ts.Type): ts.Expression {
                const enumMembers: string[] = [];
                const symbol = type.getSymbol();
                
                if (symbol && symbol.exports) {
                    symbol.exports.forEach((_, key) => {
                        enumMembers.push(key.toString());
                    });
                }
                
                return factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                        factory.createIdentifier("z"),
                        factory.createIdentifier("enum")
                    ),
                    undefined,
                    [factory.createArrayLiteralExpression(
                        enumMembers.map(member => factory.createStringLiteral(member)),
                        true
                    )]
                );
            }

            // 判断类型是否为日期类型
            function isDateType(type: ts.Type): boolean {
                const symbol = type.getSymbol();
                return !!symbol && symbol.getName() === "Date";
            }

            // 获取数组元素类型
            function getArrayElementType(type: ts.Type): ts.Type {
                return (type as ts.TypeReference).typeArguments?.[0] || typeChecker.getAnyType();
            }

            // 判断类型是否为元组类型
            function isTupleType(type: ts.Type): boolean {
                return !!(type.flags & ts.TypeFlags.Object) && 
                       !!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Tuple);
            }

            // 获取元组元素类型
            function getTupleElementTypes(type: ts.Type): ts.Type[] {
                return (type as any).typeArguments || [];
            }

            const resultFile = ts.visitNode(sourceFile, visit) as ts.SourceFile;
            
            // 过滤掉被标记为删除的语句（即返回undefined的语句）
            const filteredStatements = resultFile.statements.filter(statement => statement !== undefined);
            
            // 如果检测到了zobject调用，添加zod导入语句
            if (needsZodImport) {
                const importStatement = factory.createImportDeclaration(
                    undefined,
                    factory.createImportClause(
                        false,
                        undefined,
                        factory.createNamedImports([
                            factory.createImportSpecifier(
                                false,
                                undefined,
                                factory.createIdentifier("z")
                            )
                        ])
                    ),
                    factory.createStringLiteral("zod"),
                    undefined
                );
                filteredStatements.unshift(importStatement);
            }
            // 如果没有检测到zobject调用但有被过滤的语句，更新源文件
            return factory.updateSourceFile(
                resultFile,
                filteredStatements,
                resultFile.isDeclarationFile,
                resultFile.referencedFiles,
                resultFile.typeReferenceDirectives,
                resultFile.hasNoDefaultLib,
                resultFile.libReferenceDirectives
            );
            
            return resultFile;
        };
    };
}
