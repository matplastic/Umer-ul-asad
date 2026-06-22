import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Request Google Drive scopes
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');
provider.addScope('https://www.googleapis.com/auth/drive.file');

// Token storage with localStorage cache to keep Drive connection active upon reload
let cachedAccessToken: string | null = localStorage.getItem('apex_gdrive_token');
let isSigningIn = false;

// Initialize auth listener
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Main Sign-In with Popup
export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Google Auth');
    }
    cachedAccessToken = credential.accessToken;
    localStorage.setItem('apex_gdrive_token', cachedAccessToken);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Google Sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

// Alternative Sign-In with Redirect (very useful in iframes if popups are blocked/nested)
export const googleSignInRedirect = async (): Promise<void> => {
  isSigningIn = true;
  await signInWithRedirect(auth, provider);
};

// Check for redirection result
export const checkRedirectResult = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    const result = await getRedirectResult(auth);
    if (result) {
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        cachedAccessToken = credential.accessToken;
        localStorage.setItem('apex_gdrive_token', cachedAccessToken);
        return { user: result.user, accessToken: cachedAccessToken };
      }
    }
    return null;
  } catch (error) {
    console.error('Google checkRedirectResult error:', error);
    return null;
  }
};

// Retrieve in-memory token
export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

// Sign out
export const googleSignOut = async () => {
  await auth.signOut();
  cachedAccessToken = null;
  localStorage.removeItem('apex_gdrive_token');
};

// Helper to find or create parent folder
async function findOrCreateFolder(token: string, folderName: string): Promise<string> {
  try {
    // 1. Search for existing active folder
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    )}`;
    
    const searchResponse = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (!searchResponse.ok) {
      throw new Error(`Search folder failed: ${searchResponse.statusText}`);
    }
    
    const searchResult = await searchResponse.json();
    if (searchResult.files && searchResult.files.length > 0) {
      return searchResult.files[0].id;
    }

    // 2. Folder doesn't exist, create it
    const folderMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    };
    
    const createResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(folderMetadata),
    });

    if (!createResponse.ok) {
      throw new Error(`Folder creation failed: ${createResponse.statusText}`);
    }

    const createdFolder = await createResponse.json();
    return createdFolder.id;
  } catch (err) {
    console.error('Error in findOrCreateFolder:', err);
    throw err;
  }
}

// Upload a text/markdown/json document to "MAT_Plastic_Travelers" folder
export async function uploadToGoogleDrive(
  fileName: string,
  content: string,
  mimeType: string = 'text/plain'
): Promise<any> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('User is not authorized. Please log in with Google first.');
  }

  // Get or create the folder
  const folderId = await findOrCreateFolder(token, 'MAT_Plastic_Travelers');

  // Multi-part drive upload structure
  const metadata = {
    name: fileName,
    mimeType: mimeType,
    parents: [folderId],
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: mimeType }));

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Upload failed: ${response.status} - ${errText || response.statusText}`);
  }

  return await response.json();
}

// List backup and traveler files in Google Drive
export async function listDriveFiles(): Promise<any[]> {
  const token = cachedAccessToken;
  if (!token) {
    return [];
  }

  try {
    const folderId = await findOrCreateFolder(token, 'MAT_Plastic_Travelers');
    const q = `'${folderId}' in parents and trashed = false`;
    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,createdTime,webViewLink,size)&orderBy=createdTime desc`;

    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Listing files failed: ${res.statusText}`);
    }

    const data = await res.json();
    return data.files || [];
  } catch (err) {
    console.error('Error listing files:', err);
    return [];
  }
}

// Fetch file content from Drive
export async function downloadFileFromDrive(fileId: string): Promise<string> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('Not authenticated');
  }

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to retrieve file: ${res.statusText}`);
  }

  return await res.text();
}

// Delete file from Drive (Note: requires user confirmation before execution as per workspace guide)
export async function deleteFileFromDrive(fileId: string): Promise<boolean> {
  const token = cachedAccessToken;
  if (!token) {
    throw new Error('Not authenticated');
  }

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to delete file: ${res.statusText}`);
  }

  return true;
}
