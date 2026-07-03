import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB1kWJGR4VoxWem5PapGFgu3ldRGiqqscc",
  authDomain: "materp-fad7f.firebaseapp.com",
  projectId: "materp-fad7f",
  storageBucket: "materp-fad7f.firebasestorage.app",
  messagingSenderId: "261208029337",
  appId: "1:261208029337:web:11125823e0226c77432008"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
