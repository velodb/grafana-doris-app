declare module '@hyperdx/lucene' {
  export type Operator = 'AND' | 'OR' | 'NOT' | 'AND NOT' | 'OR NOT' | '&&' | '||' | '<implicit>';

  export type Node = NodeTerm | NodeRangedTerm;

  export interface NodeBase {
    field: string;
  }

  export interface NodeTerm extends NodeBase {
    term: string;
    prefix?: string;
    quoted?: boolean;
  }

  export interface NodeRangedTerm extends NodeBase {
    inclusive: boolean;
    term_min: string;
    term_max: string;
  }

  export interface BinaryAST {
    left: AST;
    right: AST;
    operator: Operator;
    parenthesized?: boolean;
  }

  export interface LeftOnlyAST {
    left: AST;
    start?: string;
    parenthesized?: boolean;
  }

  export type AST = Node | BinaryAST | LeftOnlyAST;

  export function parse(query: string): AST;
}

