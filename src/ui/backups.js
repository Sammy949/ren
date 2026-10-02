// A backup is a new file, never a replacement for the working notebook.
class RenBackups {
  static async write(directory, serialized) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let filename;
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = `ren-backup-${stamp}-${crypto.randomUUID()}.json`;
      try {
        await directory.getFileHandle(candidate);
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
        filename = candidate;
        break;
      }
    }
    if (!filename) throw new Error("Could not create a new backup filename");
    const file = await directory.getFileHandle(filename, { create: true });
    let stream;
    try {
      stream = await file.createWritable();
      await stream.write(serialized);
      await stream.close();
      // Do not report success just because the write was accepted.
      if (await (await file.getFile()).text() !== serialized) {
        throw new Error("Backup verification failed");
      }
    } catch (error) {
      if (stream) await stream.abort().catch(() => {});
      // Only remove this newly created failed file. Existing backups are untouched.
      await directory.removeEntry(filename).catch(() => {});
      throw error;
    }
    return filename;
  }
}
window.RenBackups = RenBackups;
