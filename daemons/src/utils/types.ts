import { Idl, IdlTypeDef } from '@project-serum/anchor/dist/cjs/idl';
import {
  AccountMap,
  IdlTypes,
  TypeDef,
} from '@project-serum/anchor/dist/cjs/program/namespace/types';
import { Rps } from '../idl/types/rps';

type AllTypes<IDL extends Idl> = IDL['accounts'] extends undefined
  ? IdlTypeDef
  : NonNullable<IDL['accounts']>[number];
type AllTypesMap<IDL extends Idl> = AccountMap<AllTypes<IDL>>;

export type RPSGameType = TypeDef<AllTypesMap<Rps>['game'], IdlTypes<Rps>>;
