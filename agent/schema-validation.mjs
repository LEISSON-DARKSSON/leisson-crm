// Deliberately small validator for the schemas shipped beside this file; rejects unknown keys.
export function validate(schema,value,path='$') {
  if(schema.type) {
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    const matches=t=>t==='null'?value===null:t==='array'?Array.isArray(value):t==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):t==='integer'?Number.isInteger(value):typeof value===t&&(t!=='number'||Number.isFinite(value));
    if(!types.some(matches)) throw new Error('schema_type:'+path);
  }
  if(value===null) return;
  if(schema.enum&&!schema.enum.includes(value))throw new Error('schema_enum:'+path);
  if(typeof value==='string'&&((schema.minLength!=null&&value.length<schema.minLength)||(schema.maxLength!=null&&value.length>schema.maxLength))) throw new Error('schema_length:'+path);
  if(typeof value==='number'&&((schema.minimum!=null&&value<schema.minimum)||(schema.maximum!=null&&value>schema.maximum)))throw new Error('schema_range:'+path);
  if(Array.isArray(value)) {
    if((schema.minItems!=null&&value.length<schema.minItems)||(schema.maxItems!=null&&value.length>schema.maxItems))throw new Error('schema_items:'+path);
    value.forEach((v,i)=>validate(schema.items,v,path+'['+i+']'));
  } else if(typeof value==='object') {
    for(const k of schema.required??[])if(!Object.hasOwn(value,k))throw new Error('schema_required:'+path+'.'+k);
    for(const k of Object.keys(value)) {
      if(!Object.hasOwn(schema.properties??{},k)){if(schema.additionalProperties===false)throw new Error('schema_extra:'+path+'.'+k);}
      else validate(schema.properties[k],value[k],path+'.'+k);
    }
  }
}
