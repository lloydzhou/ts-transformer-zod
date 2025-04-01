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
                    const zodType = mapTypeToZod(propertyType);
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

            function mapTypeToZod(type: ts.Type): ts.Expression {
                if (type.flags & ts.TypeFlags.String) {
                    return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("string")), undefined, []);
                } else if (type.flags & ts.TypeFlags.Number) {
                    return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("number")), undefined, []);
                } else if (type.flags & ts.TypeFlags.Boolean) {
                    return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("boolean")), undefined, []);
                } else if (type.flags & ts.TypeFlags.Null) {
                    return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("null")), undefined, []);
                } else if (type.flags & ts.TypeFlags.Undefined) {
                    return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("undefined")), undefined, []);
                } else if (type.isUnion()) {
                    const unionTypes = type.types.map(mapTypeToZod);
                    return factory.createCallExpression(
                        factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("union")),
                        undefined,
                        [factory.createArrayLiteralExpression(unionTypes)]
                    );
                }
                return factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier("z"), factory.createIdentifier("any")), undefined, []);
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
                
                return factory.updateSourceFile(
                    resultFile,
                    [importStatement, ...filteredStatements],
                    resultFile.isDeclarationFile,
                    resultFile.referencedFiles,
                    resultFile.typeReferenceDirectives,
                    resultFile.hasNoDefaultLib,
                    resultFile.libReferenceDirectives
                );
            }
            
            // 如果没有检测到zobject调用但有被过滤的语句，更新源文件
            if (filteredStatements.length !== resultFile.statements.length) {
                return factory.updateSourceFile(
                    resultFile,
                    filteredStatements,
                    resultFile.isDeclarationFile,
                    resultFile.referencedFiles,
                    resultFile.typeReferenceDirectives,
                    resultFile.hasNoDefaultLib,
                    resultFile.libReferenceDirectives
                );
            }
            
            return resultFile;
        };
    };
}
