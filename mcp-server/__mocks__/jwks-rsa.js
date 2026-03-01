// Stub for jwks-rsa — Jest moduleNameMapper points here so the module can be resolved.
// Tests override behaviour via jest.unstable_mockModule before importing.
export default function jwksRsa() {
  return { getSigningKey: async () => { throw new Error("jwks-rsa stub"); } };
}
