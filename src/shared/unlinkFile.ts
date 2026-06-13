import { storage } from "./storage";

const unlinkFile = async (file: string): Promise<void> => {
  await storage.remove(file);
};

export default unlinkFile;
