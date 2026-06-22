import { ObjectStorageService } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();

// ============ Upload Operations ============

/**
 * Request presigned URL for file upload
 */
export async function requestUploadUrl(fileName: string, fileSize: number, contentType: string): Promise<any> {
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    return {
      uploadURL,
      objectPath,
      metadata: { name: fileName, size: fileSize, contentType },
    };
  } catch (error) {
    throw new Error("Failed to generate upload URL");
  }
}

// ============ Download Operations ============

/**
 * Get file by path from object storage
 */
export async function getObjectByPath(objectPath: string): Promise<{ stream: any; contentType: string; contentLength: number }> {
  return objectStorageService.getObject(objectPath);
}

/**
 * Check if object exists
 */
export async function objectExists(objectPath: string): Promise<boolean> {
  try {
    await objectStorageService.getObject(objectPath);
    return true;
  } catch (error) {
    return false;
  }
}

// ============ Permissions & Access ============

/**
 * Grant permission to user for object
 */
export async function grantObjectPermission(objectPath: string, userId: number, permission: string): Promise<void> {
  // Implementation would depend on objectAcl library
  // This is a placeholder
}

/**
 * Check if user has permission to access object
 */
export async function checkObjectPermission(objectPath: string, userId: number): Promise<boolean> {
  // Implementation would depend on objectAcl library
  // This is a placeholder
  return true;
}
