import {
  setLogLevel,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- IMPORT จากไฟล์กลาง ---
import { auth, db, appId } from "./firebase-config.js";

let loggedInUser = null;
const SESSION_KEY = "gatepass_user_session";

// --- Auto Logout Configuration ---
let idleTimer;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 Minutes

// --- UI Helper Functions ---
const showModal = (message, title = "Error!", isSuccess = false) => {
  document.getElementById("modal-message").textContent = message;
  document.getElementById("modal-title").textContent = title;
  const iconContainer = document.getElementById("modal-icon-container");
  const closeButton = document.getElementById("modal-close-btn");

  iconContainer.innerHTML = isSuccess
    ? `<svg class="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`
    : `<svg class="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;

  iconContainer.className = `mx-auto flex items-center justify-center h-12 w-12 rounded-full ${
    isSuccess ? "bg-green-100" : "bg-red-100"
  }`;
  closeButton.className = `px-4 py-2 text-white text-base font-medium rounded-md w-full shadow-sm focus:outline-none focus:ring-2 ${
    isSuccess
      ? "bg-green-500 hover:bg-green-700 focus:ring-green-500"
      : "bg-red-500 hover:bg-red-700 focus:ring-red-500"
  }`;

  document.getElementById("alert-modal").classList.remove("hidden");
};
const hideModal = () =>
  document.getElementById("alert-modal").classList.add("hidden");

const showConfirmModal = (message, onConfirm) => {
  const confirmModal = document.getElementById("confirm-modal");
  document.getElementById("confirm-modal-message").textContent = message;
  const okBtn = document.getElementById("confirm-modal-ok-btn");
  const cancelBtn = document.getElementById("confirm-modal-cancel-btn");

  const newOkBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOkBtn, okBtn);
  const newCancelBtn = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  newOkBtn.addEventListener("click", () => {
    onConfirm();
    hideConfirmModal();
  });
  newCancelBtn.addEventListener("click", hideConfirmModal);
  confirmModal.classList.remove("hidden");
};
const hideConfirmModal = () =>
  document.getElementById("confirm-modal").classList.add("hidden");

const showProgressModal = (title) => {
  document.getElementById("progress-modal-title").textContent = title;
  updateProgress(0);
  document.getElementById("progress-modal").classList.remove("hidden");
};
const hideProgressModal = () =>
  document.getElementById("progress-modal").classList.add("hidden");
const updateProgress = (percentage) => {
  const p = Math.round(percentage);
  document.getElementById("progress-bar").style.width = `${p}%`;
  document.getElementById("progress-text").textContent = `${p}%`;
};

// --- Auto Logout Logic ---
const resetIdleTimer = () => {
  if (idleTimer) clearTimeout(idleTimer);
  if (loggedInUser) {
    idleTimer = setTimeout(() => {
      alert(
        "หมดเวลาการเชื่อมต่อ (ไม่มีการใช้งานเกิน 5 นาที) กรุณาเข้าสู่ระบบใหม่"
      );
      handleLogout();
    }, IDLE_TIMEOUT);
  }
};

const setupIdleListeners = () => {
  const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
  events.forEach((evt) => {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
  });
};

// --- Auth Functions ---
const bufferToHex = (buffer) => {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};
const hashPassword = async (password) => {
  const salt = "a-static-salt-for-this-app";
  const textEncoder = new TextEncoder();
  const data = textEncoder.encode(password + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(hashBuffer);
};

const handleLogin = async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";

  try {
    const userDocRef = doc(
      db,
      `artifacts/${appId}/public/data/users`,
      username.toUpperCase()
    );
    const userDoc = await getDoc(userDocRef);
    if (!userDoc.exists()) {
      errorEl.textContent = "Invalid username or password.";
      return;
    }
    const enteredPasswordHash = await hashPassword(password);
    if (enteredPasswordHash === userDoc.data().password) {
      loggedInUser = { username: userDoc.id, ...userDoc.data() };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(loggedInUser));

      document.getElementById("login-modal").classList.add("hidden");
      document.getElementById("login-form").reset();
      updateAuthUI();
      resetIdleTimer();
    } else {
      errorEl.textContent = "Invalid username or password.";
    }
  } catch (error) {
    console.error("Login error:", error);
    errorEl.textContent = "An error occurred.";
  }
};

const handleLogout = () => {
  if (idleTimer) clearTimeout(idleTimer);
  sessionStorage.removeItem(SESSION_KEY);
  loggedInUser = null;
  updateAuthUI();
};

const updateAuthUI = () => {
  const loggedInState = document.getElementById("logged-in-state");
  const loggedOutState = document.getElementById("logged-out-state");
  const usernameDisplay = document.getElementById("logged-in-username");

  if (loggedInUser) {
    usernameDisplay.textContent = loggedInUser.username;
    loggedInState.classList.remove("hidden");
    loggedOutState.classList.add("hidden");
  } else {
    loggedInState.classList.add("hidden");
    loggedOutState.classList.remove("hidden");
  }
};

const populateUserDatalist = async () => {
  if (!db) return;
  try {
    const usersCollectionRef = collection(
      db,
      `artifacts/${appId}/public/data/users`
    );
    const querySnapshot = await getDocs(usersCollectionRef);
    const datalist = document.getElementById("username-list");
    datalist.innerHTML = "";
    querySnapshot.forEach((doc) => {
      const option = document.createElement("option");
      option.value = doc.id;
      datalist.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
};

const handleChangePassword = async (e) => {
  e.preventDefault();
  const oldPassword = document.getElementById("oldPassword").value;
  const newPassword = document.getElementById("newPassword").value;
  const confirmNewPassword =
    document.getElementById("confirmNewPassword").value;
  const errorEl = document.getElementById("change-password-error");
  errorEl.textContent = "";

  if (newPassword !== confirmNewPassword) {
    errorEl.textContent = "New passwords do not match.";
    return;
  }

  try {
    const oldHash = await hashPassword(oldPassword);
    if (oldHash !== loggedInUser.password) {
      errorEl.textContent = "Incorrect old password.";
      return;
    }

    const newHash = await hashPassword(newPassword);
    await setDoc(
      doc(db, `artifacts/${appId}/public/data/users`, loggedInUser.username),
      { password: newHash },
      { merge: true }
    );
    loggedInUser.password = newHash;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(loggedInUser));

    document.getElementById("change-password-modal").classList.add("hidden");
    document.getElementById("change-password-form").reset();
    showModal("Password changed successfully!", "Success", true);
  } catch (e) {
    errorEl.textContent = "Error changing password.";
  }
};

// --- User Management Logic ---

const fetchAndRenderUsers = async () => {
  const userListBody = document.getElementById("user-list-body");
  if (!db || !userListBody) return;

  userListBody.innerHTML = `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-gray-500">Loading users...</td></tr>`;

  try {
    const usersCollectionRef = collection(
      db,
      `artifacts/${appId}/public/data/users`
    );
    const querySnapshot = await getDocs(usersCollectionRef);

    userListBody.innerHTML = "";

    if (querySnapshot.empty) {
      userListBody.innerHTML = `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-gray-500">No users found.</td></tr>`;
      return;
    }

    const isAdmin = loggedInUser && loggedInUser.username === "ADMIN";

    querySnapshot.forEach((doc) => {
      const username = doc.id;
      const tr = document.createElement("tr");

      let deleteButtonHtml = "";
      if (isAdmin && username !== "ADMIN") {
        deleteButtonHtml = `
          <button class="delete-user-btn text-red-600 hover:text-red-900" data-username="${username}">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
          </button>
        `;
      } else if (isAdmin && username === "ADMIN") {
        deleteButtonHtml = `<span class="text-xs text-gray-400">Main Admin</span>`;
      }

      tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${username}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
          ${deleteButtonHtml}
        </td>
      `;
      userListBody.appendChild(tr);
    });

    document.querySelectorAll(".delete-user-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        handleDeleteUser(btn.dataset.username)
      );
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    userListBody.innerHTML = `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-red-500">Error loading users.</td></tr>`;
  }
};

const handleAddUser = async (e) => {
  e.preventDefault();
  const username = document
    .getElementById("new-username")
    .value.trim()
    .toUpperCase();
  const password = document.getElementById("new-user-password").value;
  const confirmPassword = document.getElementById(
    "confirm-new-user-password"
  ).value;

  if (!username || !password || !confirmPassword) {
    alert("Please fill in all fields.");
    return;
  }

  if (password !== confirmPassword) {
    alert("Passwords do not match.");
    return;
  }

  showProgressModal("Creating user...");

  try {
    const userDocRef = doc(
      db,
      `artifacts/${appId}/public/data/users`,
      username
    );
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
      hideProgressModal();
      alert("Username already exists. Please choose another.");
      return;
    }

    const passwordHash = await hashPassword(password);
    await setDoc(userDocRef, { password: passwordHash });

    hideProgressModal();
    alert(`User "${username}" created successfully.`);
    document.getElementById("add-user-form").reset();
    fetchAndRenderUsers();
    populateUserDatalist();
  } catch (error) {
    console.error("Error creating user:", error);
    hideProgressModal();
    alert("Failed to create user.");
  }
};

const handleDeleteUser = async (username) => {
  if (!username) return;

  showConfirmModal(
    `Are you sure you want to delete user "${username}"?`,
    async () => {
      showProgressModal("Deleting user...");
      try {
        await deleteDoc(
          doc(db, `artifacts/${appId}/public/data/users`, username)
        );
        hideProgressModal();
        alert(`User "${username}" deleted.`);
        fetchAndRenderUsers();
        populateUserDatalist();
      } catch (error) {
        console.error("Error deleting user:", error);
        hideProgressModal();
        alert("Failed to delete user.");
      }
    }
  );
};

// --- Init ---
const init = async () => {
  if (!db) return;

  setupIdleListeners();

  const storedUser = sessionStorage.getItem(SESSION_KEY);
  if (storedUser) {
    try {
      loggedInUser = JSON.parse(storedUser);
      updateAuthUI();
      resetIdleTimer();
    } catch (e) {
      console.error("Invalid session", e);
      sessionStorage.removeItem(SESSION_KEY);
    }
  } else {
    updateAuthUI(); // Ensure correct initial state
  }

  // Common UI Listeners
  document
    .getElementById("modal-close-btn")
    .addEventListener("click", hideModal);
  document.getElementById("login-form").addEventListener("submit", handleLogin);
  document.getElementById("logout-btn").addEventListener("click", handleLogout);
  document.getElementById("login-btn-top").addEventListener("click", () => {
    populateUserDatalist();
    document.getElementById("login-modal").classList.remove("hidden");
  });
  document
    .getElementById("login-cancel-btn")
    .addEventListener("click", () =>
      document.getElementById("login-modal").classList.add("hidden")
    );

  // Change Password Listeners
  document
    .getElementById("change-password-btn")
    .addEventListener("click", () =>
      document
        .getElementById("change-password-modal")
        .classList.remove("hidden")
    );
  document
    .getElementById("change-password-cancel-btn")
    .addEventListener("click", () =>
      document.getElementById("change-password-modal").classList.add("hidden")
    );
  document
    .getElementById("change-password-form")
    .addEventListener("submit", handleChangePassword);

  // User Management Listeners
  document.getElementById("manage-users-btn").addEventListener("click", () => {
    document.getElementById("user-management-modal").classList.remove("hidden");
    fetchAndRenderUsers();
  });
  document
    .getElementById("close-user-management-btn")
    .addEventListener("click", () => {
      document.getElementById("user-management-modal").classList.add("hidden");
    });
  document
    .getElementById("add-user-form")
    .addEventListener("submit", handleAddUser);

  // Helper inputs
  document.body.addEventListener("input", (e) => {
    if (e.target.matches('input[type="text"].uppercase-input')) {
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      e.target.value = e.target.value.toUpperCase();
      e.target.setSelectionRange(start, end);
    }
  });

  // DateTime Updater
  function updateDateTime() {
    const now = new Date();
    const dateOptions = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    const timeOptions = {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    };
    const dateString = now.toLocaleDateString("th-TH", dateOptions);
    const timeString = now.toLocaleTimeString("th-TH", timeOptions);
    const dtEl = document.getElementById("datetime");
    if (dtEl) dtEl.textContent = `${dateString} เวลา ${timeString}`;
  }
  setInterval(updateDateTime, 1000);
  updateDateTime();

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      await populateUserDatalist();
    } else {
      if (typeof __initial_auth_token !== "undefined" && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    }
  });
};

document.addEventListener("DOMContentLoaded", init);