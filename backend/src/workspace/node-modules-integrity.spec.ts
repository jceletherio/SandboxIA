import {
  declaredPackages,
  isNodeModulesConsistent,
  missingPackages,
  PackageManifestLike,
} from './node-modules-integrity';

describe('declaredPackages', () => {
  it('une dependencies e devDependencies sem duplicar', () => {
    const pkg: PackageManifestLike = {
      dependencies: { rxjs: '^7.8.1', uuid: '^11.0.3' },
      devDependencies: { jest: '^30.4.2', uuid: '^11.0.3' },
    };

    expect(declaredPackages(pkg)).toEqual(['rxjs', 'uuid', 'jest']);
  });

  it('nunca lança em manifest ausente ou incompleto', () => {
    expect(declaredPackages(undefined)).toEqual([]);
    expect(declaredPackages(null)).toEqual([]);
    expect(declaredPackages({})).toEqual([]);
  });
});

describe('missingPackages / isNodeModulesConsistent', () => {
  it('acha o pacote declarado que não foi linkado — caso real do jest (MT-22)', () => {
    // No repo principal, `jest` chegou a existir no `.pnpm` store sem nunca
    // aparecer em `node_modules/jest` — `pnpm test` falhava com "jest: not
    // found" e nenhum sinal de que a causa era compartilhada entre sessões.
    const pkg: PackageManifestLike = {
      devDependencies: { jest: '^30.4.2', 'ts-jest': '^29.4.12' },
    };
    const snapshot = { present: ['ts-jest', 'typescript'] };

    expect(missingPackages(pkg, snapshot)).toEqual(['jest']);
    expect(isNodeModulesConsistent(pkg, snapshot)).toBe(false);
  });

  it('reconhece pacote escopado presente pelo nome completo', () => {
    const pkg: PackageManifestLike = { devDependencies: { '@nestjs/testing': '^11.1.28' } };
    const snapshot = { present: ['@nestjs/testing'] };

    expect(missingPackages(pkg, snapshot)).toEqual([]);
    expect(isNodeModulesConsistent(pkg, snapshot)).toBe(true);
  });

  it('considera consistente node_modules vazio quando nada é declarado', () => {
    expect(isNodeModulesConsistent({}, { present: [] })).toBe(true);
    expect(isNodeModulesConsistent({}, undefined)).toBe(true);
  });

  it('não lança com snapshot ausente', () => {
    const pkg: PackageManifestLike = { dependencies: { rxjs: '^7.8.1' } };

    expect(missingPackages(pkg, null)).toEqual(['rxjs']);
    expect(missingPackages(pkg, undefined)).toEqual(['rxjs']);
  });
});
