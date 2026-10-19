import { TFile } from "obsidian";
import { Contact } from "src/contacts";

type PropsRenderGroup = {
  queItems: InsightQueItem[];
};

type PropsRender = {
  queItem: InsightQueItem;
  dismissItem: () => void; // Callback for done or close
};

export interface InsightQueItem {
  name: string;
  runType: RunType
  file: TFile | undefined;
  message: string;
  data: any;
}

export interface InsightProcessor {
  name: string;
  /** Plain-English name for the settings screen; `name` when absent. */
  title?: string;
  render: (queItem: {
    queItem: InsightQueItem;
    dismissItem: () => void
  })  => JSX.Element | null;
  renderGroup: ({queItems}: PropsRenderGroup) => JSX.Element | null;
  runType: RunType
  settingPropertyName: string;
  settingDescription: string;
  settingDefaultValue: boolean;
  process(contacts: Contact[]): Promise<void>;
}


export interface InsighSettingProperties {
  name: string;
  title?: string;
  runType: RunType;
  settingPropertyName: string;
  settingDescription: string;
  settingDefaultValue: boolean;
}

export enum RunType {
  IMMEDIATELY = 'immediately',
  INPROVEMENT = 'inprovement',
  BATCH = 'batch',
}
