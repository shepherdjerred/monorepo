/** Import is permitted only after all immutable inputs have independently matched. */
export function guestBootstrap(
  entry: "bootstrapGuestLiveRun" | "runGuestTransport",
): string {
  return String.raw`const [file,bundle,config,artifact,payload]=process.argv.slice(1);
for(const [name,expected] of [[file,bundle],[file.replace(/live-guest\.js$/,"live-config.json"),config],[file.replace(/live-guest\.js$/,"artifact.json"),artifact],[file.replace(/live-guest\.js$/,"payload.json"),payload]]){
if(new Bun.CryptoHasher("sha256").update(await Bun.file(name).bytes()).digest("hex")!==expected)throw Error("bootstrap-binding");
}
const m=await import(file);await m.${entry}(config);`;
}
