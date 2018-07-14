import * as ts from 'typescript';
import {
  ArrayAst,
  Ast,
  FunctionAst,
  LiteralAst,
  ObjectAst,
  ObjectPropertyAst,
  RegExpAst,
  UnionAst,
  ValueAst,
} from '../ast';
import { Options } from './types';

const REGEX_STRING_TYPE = 'RegExString';

const getName = (e: ts.EntityName | ts.PropertyName) =>
  (e as ts.Identifier).escapedText as string;

function generateRegEx(node: ts.TypeReferenceNode): RegExpAst {
  if (!node || !node.typeArguments || !node.typeArguments[0]) {
    throw `Invalid RegExp type`;
  }
  const { text } = (node.typeArguments[0] as any).literal;
  const withFlags = text.match(/^\/(.*)\/(\w+)$/); // /expr/flags

  const [expr, flags] = withFlags
    ? withFlags.slice(1)
    : [text, undefined];

  return {
    key: '',
    type: 'regexp',
    value: new RegExp(expr, flags),
  };
}

const generateArray = (
  type: ts.ArrayTypeNode,
): ArrayAst => ({
  key: '',
  type: 'array',
  item: generateType(type.elementType),
});

const generateUnion = (
  node: ts.UnionTypeNode,
): UnionAst => ({
  key: '',
  type: 'union',
  items: node.types.map(t => generateType(t)),
});

const FN = () => [];

const generateTypeRef = (
  node: ts.TypeReferenceNode,
): Ast => {
  const name = getName(node.typeName);
  const isRegExp = name === REGEX_STRING_TYPE;
  if (isRegExp) return generateRegEx(node);

  return {
    name,
    key: 'ref',
    type: 'function',
    fn: FN,
  };
};

const generateBuiltIn = (s: string): FunctionAst => ({
  key: '',
  type: 'function',
  name: s,
  fn: FN,
});

const generateLiteral = (node: ts.LiteralTypeNode): LiteralAst => ({
  key: '',
  type: 'literal',
  value: ts.isLiteralExpression(node.literal)
  ? node.literal.kind === ts.SyntaxKind.FirstLiteralToken
    ? parseInt(node.literal.text, 10) // number
    : node.literal.text
  : node.literal.kind === ts.SyntaxKind.TrueKeyword
    ? true
    : false,
});

const generateValue = <T>(name: string, value: T): ValueAst<T> => ({
  name,
  value,
  key: '',
  type: 'value',
});

function generateType(
  type: ts.Node,
): Ast {
  if (ts.isTypeLiteralNode(type)) return generateObject(type);
  if (ts.isArrayTypeNode(type)) return generateArray(type);
  if (ts.isUnionTypeNode(type)) return generateUnion(type);
  if (ts.isTypeReferenceNode(type)) return generateTypeRef(type);
  if (ts.isLiteralTypeNode(type)) return generateLiteral(type);

  switch (type.kind) {
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.StringLiteral:
      return generateBuiltIn('string');
    case ts.SyntaxKind.NumberKeyword:
      return generateBuiltIn('number');
    case ts.SyntaxKind.BooleanKeyword:
      return generateBuiltIn('boolean');
    case ts.SyntaxKind.AnyKeyword:
      return generateBuiltIn('any');
    case ts.SyntaxKind.NullKeyword:
      return generateValue('null', null);
    case ts.SyntaxKind.UndefinedKeyword:
      return generateValue('undefined', undefined);
    default: {
      return {
        type: 'function',
        key: ts.SyntaxKind[type.kind],
        name: `Unkown type: ${ts.SyntaxKind[type.kind]}`,
        fn: FN,
      };
    }
  }
}

const generateAttributeValue = (
  node: ts.PropertySignature,
): Ast => {
  if (!node.type) throw `Invalid property value for ${node}`;
  const ast = generateType(node.type);
  return !!node.questionToken
    ? {
      key: '',
      type: 'union',
      items: [ast, generateValue('undefined', undefined)],
    }
    : ast;
};

const generateAttribute = (
  node: ts.PropertySignature,
): ObjectPropertyAst => ({
  key: getName(node.name),
  ast: generateAttributeValue(node),
});

function generateObject(
  node: ts.InterfaceDeclaration|ts.TypeLiteralNode,
): ObjectAst {
  const strict = !node.members.find(ts.isIndexSignatureDeclaration);

  return {
    strict,
    key: '',
    type: 'object',
    properties: node.members
      .filter(ts.isPropertySignature)
      .map(m => generateAttribute(m)),
  };
}

function generateTopLevelType(node: ts.Node, options: Options): Ast | null {
  if (ts.isTypeAliasDeclaration(node)) {
    const name = getName(node.name);
    if (options.ignore) {
      const shouldIngoreType = typeof options.ignore === 'function'
        ? options.ignore(name)
        : options.ignore.includes(name);
      if (shouldIngoreType) return null;
      if (name === REGEX_STRING_TYPE) return null;
    }

    if (ts.isFunctionTypeNode(node.type)) return null;

    return {
      ...generateType(node.type),
      key: name,
    };
  }
  if (ts.isInterfaceDeclaration(node)) {
    const name = getName(node.name);
    return {
      ...generateObject(node),
      key: name,
    };
  }

  return null;
}

const generateTypes = (nodes: ts.NodeArray<ts.Node>, options: Options): Ast[] =>
  nodes
    .map(n => generateTopLevelType(n, options))
    .filter(n => !!n) as Ast[];

export const parse = (sourceFile: ts.SourceFile, options: Options) =>
  generateTypes(sourceFile.statements, options);