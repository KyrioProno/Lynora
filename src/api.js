export async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? {} : options.body ? {'Content-Type':'application/json'} : {};
  let response;
  try { response = await fetch('/api' + path, { credentials:'same-origin', ...options, headers:{...headers,...options.headers}, body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined }); }
  catch { throw new Error('Connexion indisponible. Vérifie ton réseau et réessaie.'); }
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error || 'Une erreur est survenue.');
  return data;
}
export async function uploadImages(files) {
  if (!files?.length) return [];
  const form = new FormData(); Array.from(files).forEach(f=>form.append('images',f));
  return (await api('/upload',{method:'POST',body:form})).urls;
}
export const CATEGORIES = ['Maquillage','Mode','Beauté','Soins','Cheveux','Parfums','Lifestyle','Chaussures & sacs','Hygiène'];
export const FORMATS = [{id:'avis',label:'Avis produit'},{id:'look',label:'Look complet'},{id:'routine',label:'Routine'},{id:'découverte',label:'Coup de cœur'},{id:'comparaison',label:'Comparaison'},{id:'conseil',label:'Conseil'},{id:'tenue',label:'Tenue du jour'}];
/* Les critères vivent désormais dans shared/criteres.js, utilisé aussi par le
   serveur : impossible d'avoir une liste différente d'un côté et de l'autre.
   `criteriaFor` reste exporté : c'est le nom utilisé par les écrans existants. */
export { criteresNotes as criteriaFor, criteresTextes, groupesTextes, declarations } from '../shared/criteres.js';
export const formatPrice = value => value == null ? null : new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(value);
export const formatDate = value => new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'short',year:'numeric'}).format(new Date((value||'').replace(' ','T')+'Z'));
