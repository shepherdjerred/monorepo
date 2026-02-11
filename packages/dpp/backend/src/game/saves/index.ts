// export async function getLatestSave(): Promise<string | undefined> {
//   let saveDirectory = getConfig().game.saves.auto_import.path;

//   const parts = saveDirectory.split(sep);

//   if (parts[0] === "~") {
//     parts[0] = homedir();
//     saveDirectory = parts.reduce((memo, part) => join(memo, part), "");
//   }

//   saveDirectory = resolve(saveDirectory);

//   if (!existsSync(saveDirectory)) {
//     logger.error(addErrorLinks(`The save file path does not exist, which is ${saveDirectory}`));
//     exit(1);
//   }

//   const fileList = await readdir(saveDirectory);
//   const saveFiles = lodash.filter(fileList, (file) => file.endsWith(".srm"));
//   const saveFilesWithMetadata = await Promise.all(
//     lodash.map(saveFiles, async (file) => {
//       const meta = await stat(join(saveDirectory, file));
//       return {
//         meta,
//         file: join(saveDirectory, file),
//       };
//     }),
//   );
//   const saveFilesSortedByCreation = lodash.sortBy(saveFilesWithMetadata, (file) => file.meta.ctime);
//   const withJustPath = lodash.map(saveFilesSortedByCreation, (file) => file.file);
//   logger.info("The following save files exist, in order:", withJustPath);

//   if (withJustPath.length > 0) {
//     return resolve(withJustPath[0]);
//   } else {
//     return undefined;
//   }
// }
