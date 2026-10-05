import { data, Form, useActionData, useNavigation } from "react-router";
import { actionError, formString, load, requirePermission } from "~/.server/guards";
import { settingsOverview } from "~/.server/services/admin-workspace";
import { updateAdminSetting } from "~/.server/services/admin-crud";
import { Button, ErrorSummary, TextField } from "~/components/ui/forms";
import { PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/settings";

export async function loader({context,request}:Route.LoaderArgs){const actor=await requirePermission(context,request,"settings.view");return{items:await settingsOverview(load(context).server,actor)}}
export async function action({context,request}:Route.ActionArgs){const actor=await requirePermission(context,request,"settings.manage");const form=await request.formData();try{const key=formString(form,"key");const raw=formString(form,"value");let value:unknown;try{value=JSON.parse(raw)}catch{value=raw}await updateAdminSetting(load(context).server,actor,key,value);return data({ok:true,message:`Updated ${key}.`})}catch(e){return actionError(e)}}
export default function Settings({loaderData}:Route.ComponentProps){const result=useActionData<typeof action>();const busy=useNavigation().state==="submitting";return <><PageHeading eyebrow="Admin" title="Settings" description="Validated configuration backed by the existing settings service."/><div className="v-stack">{loaderData.items.map(item=><Panel key={item.key} title={item.key}><Form method="post" className="v-form v-form--tight"><input type="hidden" name="key" value={item.key}/><TextField name="value" label="JSON value" defaultValue={JSON.stringify(item.value,null,2)} required/><Button busy={busy} size="s">Save setting</Button></Form></Panel>)}</div>{result?.ok?<p className="v-notice v-notice--success">{result.message}</p>:null}{result&&!result.ok?<ErrorSummary message={result.message} fields={result.fields}/>:null}</>}