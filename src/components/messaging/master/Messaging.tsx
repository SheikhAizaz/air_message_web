import React from 'react';

import {Theme, withTheme} from '@material-ui/core/styles';

import styles from './Messaging.module.css';
import Sidebar from "../master/Sidebar";
import DetailThread from "../thread/DetailThread";
import DetailWelcome from "../detail/DetailWelcome";

import * as ConnectionManager from "../../../connection/connectionManager";
import {ConnectionListener, messageUpdateEmitter, modifierUpdateEmitter} from "../../../connection/connectionManager";
import {initializePeople} from "../../../util/peopleUtils";
import {ConnectionErrorCode, ParticipantActionType} from "../../../data/stateCodes";
import {
	Conversation,
	ConversationItem,
	ConversationPreviewMessage,
	MessageItem,
	MessageModifier
} from "../../../data/blocks";
import SoftDivider from "../../SoftDivider";
import {
	isConversationItemChatRenameAction,
	isConversationItemMessage,
	isConversationItemParticipantAction,
	messageItemToConversationPreview
} from "../../../util/conversationUtils";
import DetailCreate from "../create/DetailCreate";
import DetailLoading from "../detail/DetailLoading";
import DetailError from "../detail/DetailError";
import SnackbarProvider from "../../control/SnackbarProvider";
import {initializeNotifications, notificationClickEmitter, sendMessageNotification} from "../../../util/notifyUtils";

interface Props {
	theme: Theme;
}

interface State {
	conversations: Conversation[];
	conversationsAvailable: boolean;
	detailPane: DetailPane;
	sidebarBanner?: ConnectionErrorCode | "connecting";
}

enum DetailType {
	Thread,
	Create,
	Loading,
	Error,
	Welcome,
}

interface DetailPane {
	type: DetailType;
}

interface DetailPaneThread extends DetailPane {
	type: DetailType.Thread;
	conversationGUID: string;
}

interface DetailPaneError extends DetailPane {
	type: DetailType.Error;
	errorCode: ConnectionErrorCode;
}

function isDetailPaneThread(pane: DetailPane): pane is DetailPaneThread {
	return pane.type === DetailType.Thread;
}

function isDetailPaneError(pane: DetailPane): pane is DetailPaneError {
	return pane.type === DetailType.Error;
}

class Messaging extends React.Component<Props, State> {
	private readonly connectionListener: ConnectionListener = {
		onConnecting: () => {
			//Checking if conversations have never been loaded
			if(!this.state.conversationsAvailable) {
				//Displaying the full-screen loading pane
				this.setState({detailPane: {type: DetailType.Loading}});
			} else {
				//Displaying a loading indicator on the sidebar
				this.setState({sidebarBanner: "connecting"});
			}
		},
		onOpen: () => {
			//Requesting conversation details
			if(!this.state.conversationsAvailable) {
				ConnectionManager.fetchConversations().then(data => {
					if(data.length > 0) {
						this.setState({
							conversations: data,
							conversationsAvailable: true,
							detailPane: {type: DetailType.Thread, conversationGUID: data[0].guid} as DetailPaneThread
						});
					} else {
						this.setState({
							conversationsAvailable: true,
							detailPane: {type: DetailType.Welcome}
						});
					}
				});
			} else {
				//Clearing the error from the sidebar
				this.setState({sidebarBanner: undefined});
			}
		},
		onClose: (error: ConnectionErrorCode) => {
			//Checking if conversations have never been loaded
			if(!this.state.conversationsAvailable) {
				//Displaying the full-screen error pane
				this.setState({
					detailPane: {type: DetailType.Error, errorCode: error} as DetailPaneError
				});
			} else {
				//Displaying an error in the sidebar
				this.setState({sidebarBanner: error});
			}
		}
	}
	//Used to hold loose messages received from message updates until their conversation information is received, so it can be applied
	private readonly pendingConversationPreviews: Map<string, ConversationPreviewMessage> = new Map();
	
	state: Readonly<State> = {
		conversations: [],
		conversationsAvailable: false,
		detailPane: {type: DetailType.Loading}
	}
	
	render() {
		const sidebarBG = this.props.theme.palette.background.sidebar;
		
		const detailPane = this.state.detailPane;
		
		let masterNode: React.ReactNode;
		if(isDetailPaneThread(detailPane)) {
			let conversation: Conversation = this.state.conversations.find(item => item.guid === detailPane.conversationGUID)!;
			masterNode = <DetailThread conversation={conversation} key={conversation.guid}/>;
		} else if(detailPane.type === DetailType.Create) {
			masterNode = <DetailCreate onConversationCreated={this.onConversationCreated} />;
		} else if(detailPane.type === DetailType.Loading) {
			masterNode = <DetailLoading />;
		} else if(isDetailPaneError(detailPane)) {
			masterNode = <DetailError error={detailPane.errorCode} />;
		} else if(detailPane.type === DetailType.Welcome) {
			masterNode = <DetailWelcome />;
		}
		
		return (
			<SnackbarProvider>
				<div className={styles.split}>
					<div className={styles.splitDetail} style={{backgroundColor: sidebarBG}}>
						<Sidebar
							conversations={this.state.conversationsAvailable ? this.state.conversations : undefined}
							selectedConversation={(isDetailPaneThread(detailPane) && detailPane.conversationGUID) || undefined}
							onConversationSelected={this.onConversationSelected}
							onCreateSelected={this.onCreateSelected}
							errorBanner={(typeof this.state.sidebarBanner === "number") ? this.state.sidebarBanner : undefined} />
					</div>
					
					<SoftDivider vertical />
					
					<div className={styles.splitMaster}>{masterNode}</div>
				</div>
			</SnackbarProvider>
		)
	}
	
	private readonly onConversationSelected = (conversationID: string): void => {
		this.setState((prevState) => {
			//Finding the existing conversation
			const existingConversationIndex = prevState.conversations.findIndex(conversation => conversation.guid === conversationID)!;
			const existingConversation = prevState.conversations[existingConversationIndex];
			if(existingConversation.unreadMessages) {
				//Clear the conversation's unread status
				const pendingConversations: Conversation[] = [...prevState.conversations];
				pendingConversations[existingConversationIndex] = {
					...pendingConversations[existingConversationIndex],
					unreadMessages: false
				};
				
				return {
					conversations: pendingConversations,
					detailPane: {type: DetailType.Thread, conversationGUID: conversationID} as DetailPaneThread
				};
			} else {
				//Just select the conversation
				return {
					conversations: prevState.conversations,
					detailPane: {type: DetailType.Thread, conversationGUID: conversationID} as DetailPaneThread
				};
			}
		});
	}
	
	private readonly onCreateSelected = (): void => {
		this.setState({detailPane: {type: DetailType.Create}});
	}
	
	private readonly onConversationCreated = (newConversation: Conversation): void => {
		this.setState((prevState) => {
			//Checking if a conversation with a matching GUID already exists
			const matchingConversation = prevState.conversations.find(conversation => conversation.guid === newConversation.guid);
			return {
				detailPane: {
					type: DetailType.Thread,
					conversationGUID: newConversation.guid
				},
				conversations: matchingConversation ? prevState.conversations : [newConversation].concat(prevState.conversations)
			};
		});
	}
	
	componentDidMount() {
		//Subscribing to message updates
		messageUpdateEmitter.registerListener(this.onMessageUpdate);
		
		//Registering the connection listener
		ConnectionManager.addConnectionListener(this.connectionListener);
		modifierUpdateEmitter.registerListener(this.onModifierUpdate);
		
		//Registering the notification selection listener
		notificationClickEmitter.registerListener(this.onConversationSelected);
		
		//Connecting
		ConnectionManager.connect();
		
		//Loading people
		initializePeople();
		
		//Initializing notifications
		initializeNotifications();
	}
	
	componentWillUnmount() {
		//Unregistering the connection listener
		ConnectionManager.removeConnectionListener(this.connectionListener);
		
		//Unsubscribing from message updates
		messageUpdateEmitter.unregisterListener(this.onMessageUpdate);
		modifierUpdateEmitter.unregisterListener(this.onModifierUpdate);
		
		//Unregistering the notification selection listener
		notificationClickEmitter.unregisterListener(this.onConversationSelected);
		
		//Disconnecting
		ConnectionManager.disconnect();
	}
	
	private readonly onMessageUpdate = (itemArray: ConversationItem[]): void => {
		//Finding the most recent item per chat
		const sortedItems = itemArray.reduce((accumulator: {[index: string]: MessageItem}, item: ConversationItem) => {
			//If the new item isn't a message, ignore it
			if(isConversationItemMessage(item)) {
				accumulator[item.chatGuid] = accumulator[item.chatGuid] && accumulator[item.chatGuid].date > item.date ? accumulator[item.chatGuid] : item;
			}
			
			return accumulator;
		}, {});
		
		//Finding all chat GUIDs that we don't have indexed
		const newChatGUIDs = Object.keys(sortedItems).filter((chatGUID) => !this.state.conversations.find((conversation) => conversation.guid === chatGUID));
		if(newChatGUIDs.length > 0) {
			//Saving the items for later reference when we have conversation information
			for(const chatGUID of newChatGUIDs) this.pendingConversationPreviews.set(chatGUID, messageItemToConversationPreview(sortedItems[chatGUID]));
			
			//Requesting information for new chats
			ConnectionManager.fetchConversationInfo(newChatGUIDs)
				.then((result) => {
					const newConversationArray: Conversation[] = [];
					
					//Filter out failed conversations and map to conversation map
					for(const [chatGUID, conversation] of result) {
						//Checking if the conversation request failed
						if(!conversation) {
							//Ignoring this conversation and removing its associated preview
							this.pendingConversationPreviews.delete(chatGUID);
							continue;
						}
						
						//Finding and the associated preview
						const preview = this.pendingConversationPreviews.get(chatGUID);
						if(preview) {
							conversation.preview = preview;
							this.pendingConversationPreviews.delete(chatGUID);
						}
						
						//Adding the conversation to the array
						newConversationArray.push(conversation);
					}
					
					//Adding the new conversations
					if(newConversationArray.length > 0) {
						this.setState((prevState) => {
							//Cloning the conversation array
							const pendingConversationArray: Conversation[] = [...prevState.conversations];
							
							for(const newConversation of newConversationArray) {
								//Skipping conversations that already exist
								if(pendingConversationArray.find((conversation) => conversation.guid === newConversation.guid)) continue;
								
								//Sorting the conversation into the list
								let olderConversationIndex = pendingConversationArray.findIndex(conversation => conversation.preview.date < newConversation.preview.date);
								if(olderConversationIndex === -1) olderConversationIndex = pendingConversationArray.length;
								
								pendingConversationArray.splice(olderConversationIndex, 0, newConversation);
							}
							
							return {conversations: pendingConversationArray};
						});
					}
				});
		}
		
		//Updating conversations
		this.setState((prevState) => {
			//Cloning the conversation array
			const pendingConversationArray: Conversation[] = [...prevState.conversations];
			
			//Updating the conversation previews
			for(const [chatGUID, conversationItem] of Object.entries(sortedItems)) {
				const matchedConversationIndex = pendingConversationArray.findIndex((conversation) => conversation.guid === chatGUID);
				if(matchedConversationIndex === -1) continue;
				
				//Creating the updated conversation
				const updatedConversation: Conversation = {
					...pendingConversationArray[matchedConversationIndex],
					preview: messageItemToConversationPreview(conversationItem)
				};
				if(!(isDetailPaneThread(prevState.detailPane) && prevState.detailPane.conversationGUID === chatGUID) && conversationItem.sender) updatedConversation.unreadMessages = true;
				
				//Re-sorting the conversation into the list
				pendingConversationArray.splice(matchedConversationIndex, 1);
				let olderConversationIndex = pendingConversationArray.findIndex(conversation => conversation.preview.date < conversationItem.date);
				if(olderConversationIndex === -1) olderConversationIndex = pendingConversationArray.length;
				pendingConversationArray.splice(olderConversationIndex, 0, updatedConversation);
			}
			
			//Applying actionable items
			for(const conversationItem of itemArray) {
				if(isConversationItemParticipantAction(conversationItem)) {
					//Ignoring if the chat doesn't exist
					const matchedConversationIndex = pendingConversationArray.findIndex((conversation) => conversation.guid === conversationItem.chatGuid);
					if(matchedConversationIndex === -1) continue;
					
					//If we're the target, we can ignore this as we don't show up in our own copy of the member list
					if(!conversationItem.target) continue;
					
					//Updating the conversation members
					if(conversationItem.type === ParticipantActionType.Join) {
						pendingConversationArray[matchedConversationIndex] = {
							...pendingConversationArray[matchedConversationIndex],
							members: pendingConversationArray[matchedConversationIndex].members.concat(conversationItem.target)
						}
					} else if(conversationItem.type === ParticipantActionType.Leave) {
						pendingConversationArray[matchedConversationIndex] = {
							...pendingConversationArray[matchedConversationIndex],
							members: pendingConversationArray[matchedConversationIndex].members.filter((member) => member !== conversationItem.target)
						}
					}
				} else if(isConversationItemChatRenameAction(conversationItem)) {
					//Ignoring if the chat doesn't exist
					const matchedConversationIndex = pendingConversationArray.findIndex((conversation) => conversation.guid === conversationItem.chatGuid);
					if(matchedConversationIndex === -1) continue;
					
					//Renaming the conversation
					pendingConversationArray[matchedConversationIndex] = {
						...pendingConversationArray[matchedConversationIndex],
						name: conversationItem.chatName
					}
				}
			}
			
			return {
				conversations: pendingConversationArray
			};
		});
		
		{
			const sortedItemsNotification = itemArray.reduce((accumulator: {[index: string]: [MessageItem, number]}, item: ConversationItem) => {
				//If the new item isn't an incoming message, ignore it
				//if(isConversationItemMessage(item)) {
				if(isConversationItemMessage(item) && item.sender) {
					if(accumulator[item.chatGuid]) {
						if(item.date > accumulator[item.chatGuid][0].date) accumulator[item.chatGuid][0] = item;
						accumulator[item.chatGuid][1]++;
					} else {
						accumulator[item.chatGuid] = [item, 1];
					}
				}
				
				return accumulator;
			}, {});
			
			const entries = Object.entries(sortedItemsNotification);
			if(entries.length > 0) {
				for(const [chatGUID, [message, messageCount]] of entries) {
					//Finding the chat
					const conversation = this.state.conversations.find((conversation) => conversation.guid === chatGUID);
					if(!conversation) continue;
					
					//Sending a notification
					sendMessageNotification(conversation, message, messageCount);
				}
				
				//Playing a notification sound
				new Audio(process.env.PUBLIC_URL + "/audio/notification.wav").play();
			}
		}
	}
	
	private readonly onModifierUpdate = (itemArray: MessageModifier[]): void => {
		//TODO notifications
	}
}

export default withTheme(Messaging);