export async function restoreSessionOrInitializeAuth(requestSession, enterSession, initializeAuth) {
  let response;
  try {
    response = await requestSession();
  } catch {
    // A temporary session-check network error must not prevent the login form from loading.
  }

  if (response?.ok) {
    let session,parsed=false;
    try {
      session=await response.json();
      parsed=true;
    } catch {
      // Fall through to the normal authentication screen if a stale cookie response is malformed.
    }
    if(parsed){
      await enterSession(session);
      return 'restored';
    }
  }

  await initializeAuth();
  return 'login';
}
