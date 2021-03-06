import React, {FormEvent, useCallback, useEffect, useState} from "react";
import styles from "./ConnectionConfigDialog.module.css";
import {Button, Card, Dialog, DialogContent, DialogTitle, TextField, Typography} from "@material-ui/core";
import * as ConnectionManager from "shared/connection/connectionManager";
import {ConnectionListener} from "shared/connection/connectionManager";
import DataProxyTCP from "../../connection/dataProxy";
import {ConnectionErrorCode} from "shared/data/stateCodes";
import {CheckCircleOutline, CloudOff} from "@material-ui/icons";
import {errorCodeToShortDisplay} from "shared/util/languageUtils";
import {setCryptoPassword} from "shared/util/encryptionUtils";
import {SecureStorageKey, setSecureLS} from "shared/util/secureStorageUtils";

const regexInternetAddress = "^(((www\\.)?[a-zA-Z0-9.\\-_]+(\\.[a-zA-Z]{2,})+)|(\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b))([a-zA-Z0-9_\\-\\s./?%#&=]*)?(:([0-9]{1,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]?))?$";

function checkAddressError(input: string) {
	return input.length > 0 && !input.match(regexInternetAddress);
}

type ConnectionState =
	{type: "connecting"} |
	{type: "connected"} |
	{type: "disconnected", reason?: ConnectionErrorCode};

export default function ConnectionConfigDialog(props: {isOpen: boolean, onDismiss: VoidFunction, onApplyConfig: VoidFunction}) {
	const [connectionState, setConnectionState] = useState<ConnectionState>({type: "disconnected"});
	
	const [address, setAddress] = useState("");
	const [fallbackAddress, setFallbackAddress] = useState("");
	const [password, setPassword] = useState("");
	
	const inputValid = address.match(regexInternetAddress) &&
		(fallbackAddress.length === 0 || fallbackAddress.match(regexInternetAddress)) &&
		password.length > 0;
	
	const submitForm = useCallback((event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		
		//Ignoring if the input isn't valid
		if(!inputValid) return;
		
		const addressClean = address;
		const addressFallbackClean = fallbackAddress.length > 0 ? fallbackAddress : undefined;
		
		ConnectionManager.setDataProxy(new DataProxyTCP({primary: addressClean, fallback: addressFallbackClean}));
		
		ConnectionManager.setDisableAutomaticReconnections(true);
		Promise.all([
			setCryptoPassword(password),
			setSecureLS(SecureStorageKey.ServerAddress, addressClean),
			setSecureLS(SecureStorageKey.ServerAddressFallback, addressFallbackClean),
			setSecureLS(SecureStorageKey.ServerPassword, password)
		]).then(() => ConnectionManager.connect());
	}, [inputValid, address, fallbackAddress, password]);
	
	useEffect(() => {
		//Subscribing to connection updates
		const listener: ConnectionListener = {
			onConnecting(): void {
				setConnectionState({type: "connecting"});
			},
			onOpen(): void {
				setConnectionState({type: "connected"});
			},
			onClose(reason: ConnectionErrorCode): void {
				setConnectionState({type: "disconnected", reason: reason});
			}
		};
		
		ConnectionManager.addConnectionListener(listener);
		return () => ConnectionManager.removeConnectionListener(listener);
	}, [setConnectionState]);
	
	const propsOnApplyConfig = props.onApplyConfig;
	const finish = useCallback(() => {
		ConnectionManager.setDisableAutomaticReconnections(false);
		propsOnApplyConfig();
	}, [propsOnApplyConfig]);
	
	return (
		<Dialog
			open={props.isOpen}
			onClose={props.onDismiss}>
			<DialogTitle>Manual configuration</DialogTitle>
			<DialogContent>
				<form onSubmit={submitForm}>
					<TextField label="Server address" variant="filled" margin="normal" fullWidth
							   value={address} onChange={event => setAddress(event.target.value)}
							   disabled={connectionState.type !== "disconnected"}
							   error={checkAddressError(address)} />
					<TextField label="Fallback address (optional)" variant="filled" margin="normal" fullWidth
							   value={fallbackAddress} onChange={event => setFallbackAddress(event.target.value)}
							   disabled={connectionState.type !== "disconnected"}
							   error={checkAddressError(fallbackAddress)} />
					<TextField label="Password" variant="filled" type="password" autoComplete="current-password" margin="normal" fullWidth
							   value={password} onChange={event => setPassword(event.target.value)}
							   disabled={connectionState.type !== "disconnected"} />
					<div className={styles.bottomBar}>
						{connectionState.type === "connected" ? (<>
							<ConnectionCard connected={true}>Connected to server</ConnectionCard>
							
							<span className={styles.bottomBarSpacer} />
							
							<Button style={{marginRight: 16}} className={styles.bottomBarButton} variant="text" color="primary">Back</Button>
							<Button className={styles.bottomBarButton} variant="contained" color="primary" onClick={finish}>Done</Button>
						</>) : (<>
							{connectionState.type === "disconnected" && connectionState.reason !== undefined && <ConnectionCard connected={false}>{errorCodeToShortDisplay(connectionState.reason, true).message}</ConnectionCard>}
							
							<span className={styles.bottomBarSpacer} />
							
							<div className={styles.buttonWrapper}>
								<Button className={styles.bottomBarButton} variant="contained" color="primary" disabled={!inputValid || connectionState.type === "connecting"} type="submit">Check connection</Button>
							</div>
						</>)}
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ConnectionCard(props: {connected?: boolean, children?: React.ReactNode}) {
	return (
		<Card variant="outlined">
			<div className={`${styles.connectionCard} ${props.connected ? styles.connectionCardOK : ""}`}>
				{props.connected ? <CheckCircleOutline className={styles.connectionIcon} /> : <CloudOff className={styles.connectionIcon} />}
				<Typography variant="body1">{props.children}</Typography>
			</div>
		</Card>
	);
}