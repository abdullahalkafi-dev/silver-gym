import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';

/**
 * Delete a file with retry logic for EBUSY errors
 * Retries up to 3 times with 100ms delays to handle file lock issues
 */
const unlinkFile = async (file: string): Promise<void> => {
  const filePath = path.join('uploads', file);
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      if (fs.existsSync(filePath)) {
        await fsPromises.unlink(filePath);
        return; // Success
      }
      return; // File doesn't exist, that's fine
    } catch (error: any) {
      lastError = error;
      // If it's a EBUSY error and we have retries left, wait and retry
      if (error.code === 'EBUSY' && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
        continue;
      }
      // For other errors or last retry, break out of loop
      break;
    }
  }

  // Log the error but don't throw - file deletion is non-critical
  if (lastError) {
    console.error(`Failed to delete file ${filePath}:`, lastError.message);
  }
};

export default unlinkFile;
