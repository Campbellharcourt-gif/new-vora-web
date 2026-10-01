import { data, Form, Link, useActionData, useNavigation } from "react-router";
import { actionError, formString, load, requirePermission } from "~/.server/guards";
import { archiveProject, createProject, listAdminProjects, publishProject, updateProject } from "~/.server/services/admin-crud";
import { Button, ErrorSummary, TextField } from "~/components/ui/forms";
import { formatDateTime, PageHeading, Panel } from "~/components/workspace/WorkspaceShell";
import type { Route } from "./+types/projects";

export async function loader({ context, request }: Route.LoaderArgs) {
  const actor=await requirePermission(context,request,"projects.view");
  return {items:await listAdminProjects(load(context).server,actor)};
}
export async function action({context,request}:Route.ActionArgs){
  const form=await request.formData(), intent=formString(form,"intent"), server=load(context).server;
  try{
    const actor=await requirePermission(context,request,intent==="create"?"projects.create":intent==="update"?"projects.edit":"projects.publish");
    if(intent==="create"){await createProject(server,actor,Object.fromEntries(form));return data({ok:true,message:"Project created."});}
    const id=formString(form,"id");
    if(intent==="update"){await updateProject(server,actor,id,Object.fromEntries(form));return data({ok:true,message:"Project saved."});}
    if(intent==="publish"){await publishProject(server,actor,id);return data({ok:true,message:"Project published."});}
    if(intent==="archive"){await archiveProject(server,actor,id);return data({ok:true,message:"Project archived."});}
    return data({ok:false,message:"Unknown action.",fields:{}},{status:400});
  }catch(e){return actionError(e)}
}
export default function Projects({loaderData}:Route.ComponentProps){
 const result=useActionData<typeof action>(); const busy=useNavigation().state==="submitting";
 return <><PageHeading eyebrow="Admin" title="Projects" description="Create, edit, publish and archive public case studies."/>
 {result?.ok?<p className="v-notice v-notice--success">{result.message}</p>:null}{result&&!result.ok?<ErrorSummary message={result.message} fields={result.fields}/>:null}
 <Panel title="New project"><Form method="post" className="v-form v-form--tight"><input type="hidden" name="intent" value="create"/><TextField name="title" label="Title" required/><TextField name="slug" label="Slug" required/><TextField name="category" label="Category"/><TextField name="summary" label="Summary"/><TextField name="year" label="Year" type="number"/><TextField name="clientName" label="Client name"/><TextField name="externalUrl" label="External URL"/><TextField name="body" label="Content blocks JSON" defaultValue="[]" /><Button busy={busy} size="s">Create project</Button></Form></Panel>
 <Panel title="Projects" flush>{loaderData.items.length===0?<div className="v-panel__body"><p className="v-body">No projects yet.</p></div>:<div className="v-tablewrap"><table className="v-table v-table--stack"><caption className="v-sr">Projects</caption><thead><tr><th>Project</th><th>Status</th><th>Client</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{loaderData.items.map(p=><tr key={p.id}><td><strong>{p.title}</strong><div className="v-body-s">{p.slug}</div></td><td>{p.status}{p.hasUnpublishedChanges?" · draft":""}</td><td>{p.clientName??"—"}</td><td className="v-data">{formatDateTime(p.updatedAt)}</td><td><div className="v-actions"><Link className="v-btn v-btn--secondary v-btn--s" to={`/admin/projects/${p.id}`}>Edit</Link><Form method="post"><input type="hidden" name="id" value={p.id}/><input type="hidden" name="intent" value="publish"/><button className="v-btn v-btn--secondary v-btn--s" disabled={!p.hasUnpublishedChanges}>Publish</button></Form><Form method="post"><input type="hidden" name="id" value={p.id}/><input type="hidden" name="intent" value="archive"/><button className="v-btn v-btn--secondary v-btn--s">Archive</button></Form></div></td></tr>)}</tbody></table></div>}</Panel></>;
}
