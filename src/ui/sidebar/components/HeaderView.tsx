import { setIcon } from "obsidian";
import * as React from "react";
import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { insightService } from "src/insights/insightService";
import { insightQueueStore } from "src/insights/insightsQueStore";
import { Sort } from "src/util/constants";

type HeaderProps = {
  onSortChange: React.Dispatch<React.SetStateAction<Sort>>;
  sort: Sort;
  onCreateContact: () => void;
  importVCF: () => void;
  /** Present when an address book is active: opens the "Import contact from server" picker. */
  importFromServer?: () => void;
  /** Present when an address book is active: opens the "Sync all contacts" tab. */
  syncAll?: () => void;
  exportAllVCF: () => void;
  setDisplayImportView: Dispatch<SetStateAction<boolean>>;
}

export const HeaderView = (props: HeaderProps) => {
	const buttons = useRef<(HTMLElement | null)[]>([]);
  const [count, setCount] = useState<number>(insightQueueStore.insightQueItemCount.value);
  const [importLoading, setImportLoading] = useState<boolean>(insightService.backgroundProcessRunning.value);

	useEffect(() => {
		buttons.current.forEach(setIconForButton);
	}, [buttons, props.importFromServer !== undefined, props.syncAll !== undefined]);

  useEffect(() => {
    const unsubscribe = insightQueueStore.insightQueItemCount.subscribe((newValue) => {
      setCount(newValue);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = insightService.backgroundProcessRunning.subscribe((loading) => {
      setImportLoading(loading);
    });
    return () => unsubscribe();
  }, []);


  return (
    <div className="nav-buttons-container">
      <div
        id="create-btn"
        className="clickable-icon nav-action-button"
        data-icon="contact"
        aria-label="Create new contact"
        ref={(element) => (buttons.current[1] = element)}
        onClick={props.onCreateContact}/>

      <div
        id="import-vcf-btn"
        data-icon="file-down"
        className={"clickable-icon nav-action-button "}
        aria-label="Import vcf"
        ref={(element) => (buttons.current[2] = element)}
        onClick={props.importVCF}/>
      {props.importFromServer && (
        <div
          id="import-from-server-btn"
          data-icon="cloud-download"
          className={"clickable-icon nav-action-button "}
          aria-label="Import contact from server"
          ref={(element) => (buttons.current[9] = element)}
          onClick={props.importFromServer}/>
      )}
      {props.syncAll && (
        <div
          id="sync-all-btn"
          data-icon="refresh-cw"
          className={"clickable-icon nav-action-button "}
          aria-label="Sync all contacts"
          ref={(element) => (buttons.current[10] = element)}
          onClick={props.syncAll}/>
      )}
      <div
        id="import-vcf-btn"
        data-icon="file-up"
        className={"clickable-icon nav-action-button "}
        aria-label="Export vcf"
        ref={(element) => (buttons.current[3] = element)}
        onClick={props.exportAllVCF}/>

      <div className="menu-vert"></div>
      <div
        id="sort-by-name-btn"
        data-icon="baseline"
        className={"clickable-icon nav-action-button " +
          (props.sort === Sort.NAME && "is-active")}
        aria-label="Sort by name"
        ref={(element) => (buttons.current[4] = element)}
        onClick={() => props.onSortChange(Sort.NAME)}/>
      <div
        id="sort-by-birthday-btn"
        data-icon="cake"
        className={"clickable-icon nav-action-button " +
          (props.sort === Sort.BIRTHDAY && "is-active")}
        aria-label="Sort by birthday"
        ref={(element) => (buttons.current[6] = element)}
        onClick={() => props.onSortChange(Sort.BIRTHDAY)}/>
      <div
        id="sort-by-organization-btn"
        data-icon="building"
        className={"clickable-icon nav-action-button " +
          (props.sort === Sort.ORG && "is-active")}
        aria-label="Sort by organization"
        ref={(element) => (buttons.current[7] = element)}
        onClick={() => props.onSortChange(Sort.ORG)}/>

      <div className="menu-vert"></div>

      <div className="badge-wrapper">
        <div
          id="import-panel-btn"
          data-icon="inbox"
          className={[
            "clickable-icon",
            "nav-action-button",
            importLoading && "is-pulsing",
          ].filter(Boolean).join(" ")}
          aria-label="Import contacts from address books"
          ref={(element) => (buttons.current[8] = element)}
          onClick={() => props.setDisplayImportView(true)}/>
        {count > 0 && (
          <span className="badge-count">{count}</span>
        )}
      </div>

    </div>
  );
};

function setIconForButton(button: HTMLElement | null) {
	if (button != null) {
		const icon = button.getAttr("data-icon");
		if (icon != null) {
			setIcon(button, icon);
		}
	}
}
