/**
 * electron-builder custom sign hook — intentional no-op for local/unsigned builds.
 * Production CI uses Azure Trusted Signing via azureSignOptions in the build config.
 */
exports.default = async function sign(configuration) {
  // No-op: skip code signing for local builds
};
