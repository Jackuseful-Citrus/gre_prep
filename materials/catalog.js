(() => {
  'use strict';
  const categories={questions:'题目与原书',vocabulary:'词汇资料',reference:'参考资料'};
  const documents=(window.GRE_MATERIALS?.documents||[]).filter(item=>
    item&&typeof item.path==='string'&&item.path.startsWith('materials/')&&
    !item.path.split('/').some(part=>part==='..'||part==='.')&&categories[item.category]
  ).map(item=>({...item,search:[item.title,...(item.aliases||[])].join(' ').normalize('NFKC').toLocaleLowerCase('zh-CN')}))
    .sort((a,b)=>a.title.localeCompare(b.title,'zh-CN',{numeric:true}));
  const search=document.getElementById('material-search'),list=document.getElementById('material-list');
  const status=document.getElementById('result-count'),empty=document.getElementById('empty-state');
  let category='all';
  const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
  const size=bytes=>bytes>=1024*1024?`${(bytes/(1024*1024)).toFixed(1)} MB`:`${Math.max(1,Math.round(bytes/1024))} KB`;
  for(const count of document.querySelectorAll('[data-count]')){
    count.textContent=String(count.dataset.count==='all'?documents.length:documents.filter(item=>item.category===count.dataset.count).length);
  }
  function render(){
    const query=search.value.trim().normalize('NFKC').toLocaleLowerCase('zh-CN');
    const terms=query.split(/\s+/).filter(Boolean);
    const shown=documents.filter(item=>(category==='all'||item.category===category)&&terms.every(term=>item.search.includes(term)));
    const fragment=document.createDocumentFragment();
    for(const item of shown){
      const link=document.createElement('a');link.className='material-card';
      link.href=item.path.slice('materials/'.length).split('/').map(encodeURIComponent).join('/');
      const extension=item.path.split('.').pop().toUpperCase();
      link.append(text('span',categories[item.category],'material-category'),text('h2',item.title));
      const meta=text('span','','material-meta');
      meta.append(text('span',extension),text('span',size(item.bytes)),text('span','打开资料 ↗','material-open'));
      link.append(meta);fragment.append(link);
    }
    list.replaceChildren(fragment);empty.hidden=shown.length>0;
    status.textContent=`显示 ${shown.length} / ${documents.length} 份资料`;
    for(const button of document.querySelectorAll('[data-category]'))button.setAttribute('aria-pressed',String(button.dataset.category===category));
  }
  search.addEventListener('input',render);
  document.getElementById('clear-search').addEventListener('click',()=>{search.value='';render();search.focus();});
  document.querySelector('.catalog-filters').addEventListener('click',event=>{
    const button=event.target.closest('[data-category]');if(!button)return;
    category=button.dataset.category;render();
  });
  render();
})();
