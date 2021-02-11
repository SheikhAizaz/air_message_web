import React from "react";
import ReactDOM from "react-dom";

import * as config from "./secure/config";

import AppTheme from "./components/control/AppTheme";
import LoginGate from "./components/control/LoginGate";

import firebase from "firebase/app";
import "firebase/auth";

import * as Sentry from "@sentry/react";

//Initializing Firebase
firebase.initializeApp(config.firebaseConfig);

export let promiseGAPI: Promise<any>;

//Initializing Sentry
if(import.meta.env.NODE_ENV === "production") {
	Sentry.init({
		dsn: config.sentryDSN,
		release: "airmessage-web@" + import.meta.env.SNOWPACK_PUBLIC_VERSION,
		environment: import.meta.env.NODE_ENV
	});
}

//Browser-specific features
if(!import.meta.env.SNOWPACK_PUBLIC_ELECTRON) {
	// Check that service workers are supported
	if(import.meta.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
		// Use the window load event to keep the page load performant
		window.addEventListener("load", () => {
			navigator.serviceWorker.register("/sw.js");
		});
	}
	
	//Loading the Google platform script
	promiseGAPI = new Promise<any>((resolve) => {
		const script = document.createElement("script");
		script.setAttribute("src","https://apis.google.com/js/platform.js");
		script.onload = resolve;
		document.head.appendChild(script);
	});
}

//Initializing React
ReactDOM.render(
	<React.StrictMode>
		<AppTheme>
			<LoginGate />
		</AppTheme>
	</React.StrictMode>,
	document.getElementById("root")
);

// Hot Module Replacement (HMR) - Remove this snippet to remove HMR.
// Learn more: https://www.snowpack.dev/concepts/hot-module-replacement
if(import.meta.hot) {
	import.meta.hot.accept();
}