
// Uncomment the code arc.run.. below to enable this plugin


arc.run(['$rootScope', function ($rootScope) {

    $rootScope.plugin("arcTemplate", "Template Title", "page", {
        menu: "tools",
        icon: "fa-paw",
        description: "This plugin can be used as a starting point for building new page plugins",
        author: "Cubewise",
        url: "https://github.com/cubewise-code/arc-plugins",
        version: "1.0.0"
    });

}]);


arc.directive("arcTemplate", function () {
    return {
        restrict: "EA",
        replace: true,
        scope: {
            instance: "=tm1Instance"
        },
        templateUrl: "__/plugins/template-page/template.html",
        link: function ($scope, element, attrs) {

        },
        controller: ["$scope", "$rootScope", "$http", "$tm1", "$translate", "$timeout", function ($scope, $rootScope, $http, $tm1, $translate, $timeout) {

            // Constants
            const FIXED_INSTANCE = "c000_kbs";
            const CUBE_NAME = "Sys Documentation"; 
            const DIM_TM1_OBJECT_TYPE = "TM1 Object Type"
            const DIM_INSTANCE = "Instance";     
            const DIM_TM1_OBJECT = "TM1 Object";
            const DIM_UPDATE_RECORD = "Update Record";
            const DIM_M_SYS_DOCUMENTATION = "M Sys Documentation"
            const DIM_BUSINESS_PROCESS = "p_Business Process";
            const DIM_USER_INTERFACE = "p_User Interface";
            const ELEM_UPDATE = "Update Input";
            const TI_UPDATE = "Cub.Sys Documentation.Update Sign Off";
            let edgesCache = null;

            const M_SYS_DOCUMENTATION_KEYS = [
              "Requirement",
              "How to Use",
              "Maintenance",
              "Relevant Biz Process",
              "Additional Information",
              "User Interface",
              "Managers Sign Off",
              "Status",
              "Used"
            ];

            const TM1_OBJECT_TYPE_MAP = {
              PAW: "PAW",
              Application: "Applications",
              Cube: "Cubes",
              Dimension: "Dimensions",
              Process: "Processes",
              Chore: "Chores",
              UX: "UX"
            }
          
            // Data holders
            $scope.values = { 
                current_user: '',
                loading: true,
                tm1_object_type: null,
                tm1_object_type_options: [],
                business_process_options: [],
                user_interface_options: [],
                tree_data: [],
                selected_tm1_object: null,
                selected_tm1_object_id: null,
                updates: {},
                updates_meta: {},
                form: {},
                form_original: {},

                // for multi select
                user_interface_candidate: null,
                biz_process_candidate: null
            };

            // Utils
            function emptyInfo() {
              return M_SYS_DOCUMENTATION_KEYS.reduce((acc, k) => ((acc[k] = ""), acc), {});
            }

            function valOf(cell) {
              return cell?.FormattedValue ?? cell?.Text ?? cell?.Value ?? "";
            }

            function findNodeByInstanceAndObject(instance, tm1Object) {
              const pack = ($scope.values.tree_data || []).find(x => x.instance === instance);
              if (!pack) return null;
            
              function dfs(list) {
                for (const n of (list || [])) {
                  if (n.tm1_object === tm1Object) return n;
                  const hit = dfs(n.nodes);
                  if (hit) return hit;
                }
                return null;
              }
              return dfs(pack.tm1_objects);
            }

            function esc(s) { 
              return String(s || "").replace(/'/g, "''"); 
            }

            function toStoredValue(val) {
              return  (val == null ? "" : String(val));
            }
            
            function buildUpdatePayloadsFromUpdates() {
              const updates = $scope.values.updates || {};
              const payload = [];
            
              Object.keys(updates).forEach(function (uiType) {
                const perInst = updates[uiType] || {};
            
                Object.keys(perInst).forEach(function (inst) {
                  const perObj = perInst[inst] || {};
            
                  Object.keys(perObj).forEach(function (obj) {
                    const perMeasure = perObj[obj] || {};
            
                    Object.keys(perMeasure).forEach(function (measure) {
                      const rawVal = perMeasure[measure];
                      const value = toStoredValue(rawVal);
            
                      payload.push({
                        "Cells": [
                          {
                            "Tuple@odata.bind": [
                              "Dimensions('Instance')/Hierarchies('Instance')/Elements('" + esc(inst) + "')",
                              "Dimensions('TM1 Object Type')/Hierarchies('TM1 Object Type')/Elements('" + esc(uiType) + "')",
                              "Dimensions('TM1 Object')/Hierarchies('TM1 Object')/Elements('" + esc(obj) + "')",
                              "Dimensions('Update Record')/Hierarchies('Update Record')/Elements('" + esc(ELEM_UPDATE) + "')",
                              "Dimensions('M Sys Documentation')/Hierarchies('M Sys Documentation')/Elements('" + esc(measure) + "')"
                            ]
                          }
                        ],
                        "Value": value
                      });
                    });
                  });
                });
              });
            
              console.log('updates ===', updates)
              return payload;
            }

            function loadAllEdgesOnce() {
              if (edgesCache) {
                return Promise.resolve(edgesCache);
              }
            
              const url =
                `/Dimensions('${DIM_TM1_OBJECT}')/Hierarchies('${DIM_TM1_OBJECT}')/Edges` +
                `?$select=ParentName,ComponentName,Weight`;
            
              return $tm1.async(FIXED_INSTANCE, "GET", url).then(function (resp) {
                const rows = (resp && resp.data && resp.data.value) || [];
            
                const childrenByParent = {};
                const allNodes = new Set();
            
                rows.forEach(function (e) {
                  const parent = e.ParentName;
                  const child  = e.ComponentName;
            
                  if (!childrenByParent[parent]) {
                    childrenByParent[parent] = [];
                  }
                  childrenByParent[parent].push(child);
            
                  allNodes.add(parent);
                  allNodes.add(child);
                });
            
                edgesCache = { childrenByParent, allNodes };
                return edgesCache;
              });
            }

            // Get current user
            function loadCurrentUser() {
              $tm1.instance(FIXED_INSTANCE).then(function (instanceInfo) {
                $scope.values.current_user = instanceInfo.user.FriendlyName
              });
            }

            // Load elements from a dimension
            $scope.loadElements = function (dim, container) {
                const restPath = `/Dimensions('${dim}')/Hierarchies('${dim}')/Elements?$select=Name&$filter=Level eq 0`;
                $tm1.async(FIXED_INSTANCE, 'GET', restPath)
                .then(function (resp) {
                    const list =  resp?.data?.value || [];
                    $scope.values[container] = list;

                    // default
                    if (container === 'tm1_object_type_options' && list.length) {
                      $scope.values.tm1_object_type = list[1].Name;
                      $timeout($scope.onUIChange, 0);
                    }
                })
                .catch(function (err) {
                  console.log('loadElements error: ', err)
                })
            };

            // Load TM1 object hierarchy edges
            function fetchEdges(uiTypeKey) {
              const typeName = TM1_OBJECT_TYPE_MAP[uiTypeKey];
              if (!typeName) {
                return Promise.resolve({ childrenByParent: {}, allNodes: new Set() });
              }
            
              const targetRoot = `Total ${typeName}`; 
            
              return loadAllEdgesOnce().then(function (base) {
                const childrenByParent = base.childrenByParent;
            
                const allowed = new Set();
            
                function dfs(name) {
                  if (!name || allowed.has(name)) return;
                  allowed.add(name);
                  const childs = childrenByParent[name] || [];
                  for (var i = 0; i < childs.length; i++) {
                    dfs(childs[i]);
                  }
                }
            
                dfs(targetRoot);
            
                const filteredChildrenByParent = {};
                allowed.forEach(function (parent) {
                  const childs = (childrenByParent[parent] || []).filter(function (c) {
                    return allowed.has(c);
                  });
                  if (childs.length) {
                    filteredChildrenByParent[parent] = childs;
                  }
                });
            
                return {
                  childrenByParent: filteredChildrenByParent,
                  allNodes: allowed
                };
              });
            }

            // Build nested tree from edges
            function buildTreeFromEdges(edges) {
              const { childrenByParent, allNodes } = edges;
              const allChildren = new Set(
                [].concat(...Object.values(childrenByParent))
              );
              const roots = Array.from(allNodes).filter(
                (n) => !allChildren.has(n)
              );
    
              const build = (name) => ({
                tm1_object: name,
                nodes: (childrenByParent[name] || []).map((child) => build(child))
              });
    
              return roots.map((r) => build(r));
            }

            // Merge info + expanded flags into tree
            function mergeTree(nodes, getInfo, instance = null, level = 0, path = []) {
              return nodes.map((node, idx) => {
                const currentPath = path.concat(node.tm1_object || String(idx));
                const _id = instance
                  ? [instance].concat(currentPath).join("/")
                  : currentPath.join("/");
            
                return {
                  _id,
                  tm1_object: node.tm1_object,
                  info: getInfo(node.tm1_object) || emptyInfo(),
                  expanded: false,
                  nodes: mergeTree(node.nodes || [], getInfo, instance, level + 1, currentPath)
                };
              });
            }

            function isNodeUsed(node) {
              return node && node.info && (node.info.Used === "1" || node.info.Used === 1);
            }

            function filterTreeByUsed(nodes) {
              const result = [];
            
              (nodes || []).forEach(function (node) {
                node.nodes = filterTreeByUsed(node.nodes || []);
            
                const selfUsed = isNodeUsed(node);
                const hasChild = node.nodes && node.nodes.length > 0;
            
                if (selfUsed || hasChild) {
                  result.push(node);
                }
              });
            
              return result;
            }

            function snapshotExpanded(treeData) {
              // { [instance]: { instanceExpanded, nodeExpanded: { [nodeId]: true } } }
              const map = {}; 
            
              (treeData || []).forEach(function (pack) {
                const inst = pack.instance;
                if (!inst) return;
            
                if (!map[inst]) {
                  map[inst] = {
                    instanceExpanded: !!pack.expanded,
                    nodeExpanded: {}
                  };
                }
            
                function walk(node) {
                  if (!node) return;
                  map[inst].nodeExpanded[node._id] = !!node.expanded;
                  (node.nodes || []).forEach(walk);
                }
            
                (pack.tm1_objects || []).forEach(walk);
              });
            
              return map;
            }

            // Run MDX and expand
            function executeMDXExpanded(mdx) {
              const url =
                "/ExecuteMDX?" +
                "$expand=" +
                "Axes($expand=Tuples($expand=Members($select=Name,UniqueName)))," +
                "Cells($select=Ordinal,Value,FormattedValue)";
    
              return $tm1.async(FIXED_INSTANCE, "POST", url, { MDX: mdx })
                .then((resp) => {
                  
                  if (resp?.status === 200 && resp?.data?.Axes) {
                    return resp.data;
                  }
    
                  if (resp?.status === 201 && resp?.data?.ID) {
                    const id = resp.data.ID;
                    const getUrl =
                      `/Cellsets('${id}')?` +
                      `$expand=Axes($expand=Tuples($expand=Members($select=Name,UniqueName))),` +
                      `Cells($select=Ordinal,Value,FormattedValue)`;
    
                    return $tm1.async(FIXED_INSTANCE, "GET", getUrl)
                      .then((res2) => res2?.data)
                      .finally(() => {
                        $tm1.async(FIXED_INSTANCE, "DELETE", `/Cellsets('${id}')`);
                      });
                  }
    
                  throw new Error("ExecuteMDX did not return Axes/Cells nor ID");
                });
            }

            // Fetch documentation cube values
            function fetchDocCells(tm1ObjectType) {
              const mdx = `
                SELECT
                  CrossJoin(
                    [${DIM_INSTANCE}].[${DIM_INSTANCE}].Members,
                    TM1SubsetToSet([${DIM_M_SYS_DOCUMENTATION}].[${DIM_M_SYS_DOCUMENTATION}], "zJC_spa")
                  ) ON COLUMNS,
                  { TM1DRILLDOWNMEMBER({[${DIM_TM1_OBJECT}].[${DIM_TM1_OBJECT}].Members}, ALL, RECURSIVE) } ON ROWS
                FROM [${CUBE_NAME}]
                WHERE (
                  [${DIM_TM1_OBJECT_TYPE}].[${DIM_TM1_OBJECT_TYPE}].[${tm1ObjectType}],
                  [${DIM_UPDATE_RECORD}].[${DIM_UPDATE_RECORD}].[${ELEM_UPDATE}]
                )
              `;
    
              return executeMDXExpanded(mdx).then((data) => {
                const axes = data?.Axes || [];
                const cells = data?.Cells || [];
                const rowsTuples = axes[1]?.Tuples || [];
                const colsTuples = axes[0]?.Tuples || [];
    
                const rowObjNames = rowsTuples.map(t => t.Members[0].Name);
    
                const colSlots = colsTuples.map(t => {
                  const members = t.Members || [];
                  let instance = null;
                  let colName = null;
    
                  members.forEach(m => {
                    const uq = m.UniqueName || "";
                    if (uq.indexOf(`[${DIM_INSTANCE}]`) >= 0) instance = m.Name;
                    else if (uq.indexOf(`[${DIM_M_SYS_DOCUMENTATION}]`) >= 0) colName = m.Name;
                    else {
                    }
                  });
                  
                  return { instance, colName };
                });
    
                const instances = Array.from(new Set(colSlots.map(c => c.instance).filter(Boolean)));
                const cellMap = {};
                const colCount = colSlots.length;
  
                rowObjNames.forEach((objName, r) => {
                  colSlots.forEach((slot, c) => {
                    const cell = cells[r * colCount + c];
                    if (!slot?.instance) return; 
                    const key = `${slot.instance}|${objName}`;
                    if (!cellMap[key]) cellMap[key] = emptyInfo();
    
                    if (slot.colName && M_SYS_DOCUMENTATION_KEYS.includes(slot.colName)) {
                      cellMap[key][slot.colName] = String(valOf(cell));
                    }
                  });
                });
    
                return { instances, cellMap };
              });
            }

            // Load Tree 
            $scope.loadInstanceObjectTree = async function () {
              const tm1ObjectType = $scope.values.tm1_object_type;
              if (!tm1ObjectType) return Promise.resolve();
            
              const prevExpanded = snapshotExpanded($scope.values.tree_data);
            
              $scope.values.loading = true;
            
              return Promise.all([fetchEdges(tm1ObjectType), fetchDocCells(tm1ObjectType)])
                .then(function ([edges, doc]) {
                  let baseTree = buildTreeFromEdges(edges);

                  if (baseTree.length === 1 && /^Total\s+/i.test(baseTree[0].tm1_object)) {
                    baseTree = baseTree[0].nodes || [];
                  }
            
                  let nextTreeData = doc.instances.map(function (inst) {
                    const merged = mergeTree(
                      baseTree,
                      function (o) {
                        return doc.cellMap[inst + "|" + o];
                      },
                      inst
                    );
            
                    const filtered = filterTreeByUsed(merged);
                    const instSnap = prevExpanded[inst];
                    const instExpanded = instSnap ? instSnap.instanceExpanded : true;
                    const nodeExpandedMap = instSnap ? instSnap.nodeExpanded : {};
            
                    if (instSnap) {
                      function applyExpanded(node) {
                        if (nodeExpandedMap[node._id]) {
                          node.expanded = true;
                        }
                        (node.nodes || []).forEach(applyExpanded);
                      }
                      filtered.forEach(applyExpanded);
                    }
            
                    return {
                      instance: inst,
                      isInstance: true,
                      expanded: instExpanded,
                      tm1_objects: filtered
                    };
                  });
            
                  nextTreeData = nextTreeData.filter(function (pack) {
                    return pack.tm1_objects && pack.tm1_objects.length > 0;
                  });
            
                  $scope.values.tree_data = nextTreeData;
            
                  // console.log("tree_data ===", $scope.values.tree_data);
                })
                .catch(function (err) {
                  console.log('loadInstanceObjectTree error: ', err)  
                })
                .finally(function () {
                  $scope.values.loading = false;
                  $scope.$applyAsync();
                });
            };

            // Build update record
            function ensureUpdatesBucket(tm1ObjectType, instance, obj) {
              if (!$scope.values.updates[tm1ObjectType]) $scope.values.updates[tm1ObjectType] = {};
              if (!$scope.values.updates[tm1ObjectType][instance]) $scope.values.updates[tm1ObjectType][instance] = {};
              if (!$scope.values.updates[tm1ObjectType][instance][obj]) $scope.values.updates[tm1ObjectType][instance][obj] = {};
              return $scope.values.updates[tm1ObjectType][instance][obj];
            }

            function ensureUpdatesMetaWithOriginal(tm1ObjectType, instance, obj, originalInfo) {
              if (!$scope.values.updates_meta[tm1ObjectType]) $scope.values.updates_meta[tm1ObjectType] = {};
              if (!$scope.values.updates_meta[tm1ObjectType][instance]) $scope.values.updates_meta[tm1ObjectType][instance] = {};
              if (!$scope.values.updates_meta[tm1ObjectType][instance][obj]) {
                $scope.values.updates_meta[tm1ObjectType][instance][obj] = {
                  original: angular.copy(originalInfo || {})
                };
              }
              return $scope.values.updates_meta[tm1ObjectType][instance][obj];
            }

            function cleanupUpdatesBucketIfEmpty(tm1ObjectType, instance, obj) {
              const box = $scope.values.updates[tm1ObjectType]?.[instance]?.[obj];
              if (box && Object.keys(box).length === 0) {
                delete $scope.values.updates[tm1ObjectType][instance][obj];
            
                if (Object.keys($scope.values.updates[tm1ObjectType][instance]).length === 0) {
                  delete $scope.values.updates[tm1ObjectType][instance];
                }
                if (Object.keys($scope.values.updates[tm1ObjectType]).length === 0) {
                  delete $scope.values.updates[tm1ObjectType];
                }
            
                if ($scope.values.updates_meta[tm1ObjectType]?.[instance]?.[obj]) {
                  delete $scope.values.updates_meta[tm1ObjectType][instance][obj];
                  if (Object.keys($scope.values.updates_meta[tm1ObjectType][instance]).length === 0) {
                    delete $scope.values.updates_meta[tm1ObjectType][instance];
                  }
                  if (Object.keys($scope.values.updates_meta[tm1ObjectType]).length === 0) {
                    delete $scope.values.updates_meta[tm1ObjectType];
                  }
                }
              }
            }

            // Execute TI
            function executeUpdateTI(instance, objType, obj, method) {
            
              const tiUrl = "/Processes('" + TI_UPDATE + "')/tm1.Execute";
            
              const body = {
                Parameters: [
                  { Name: "pDebug",    Value: "0" },
                  { Name: "pInstance", Value: instance },
                  { Name: "pObjType",  Value: objType },
                  { Name: "pObj",      Value: obj},
                  { Name: "pMethod",   Value: method }
                ]
              };
 
              return $tm1.async(FIXED_INSTANCE, "POST", tiUrl, body);
            }

            // Init 
            $scope.loadElements(DIM_TM1_OBJECT_TYPE, 'tm1_object_type_options');
            $scope.loadElements(DIM_BUSINESS_PROCESS, 'business_process_options');
            $scope.loadElements(DIM_USER_INTERFACE, 'user_interface_options');
            loadCurrentUser()

            // Actions 
            $scope.onUIChange = function () {
              if (!$scope.values.tm1_object_type) return;
              $scope.loadInstanceObjectTree();
              $scope.values.form = null;
              $scope.values.form_original = null;
              $scope.values.selected_tm1_object = null;
              $scope.values.selected_tm1_object_id = null;
            };

            $scope.isFormReadOnly = function () {
              if ($scope.values.loading) {
                return true;
              }
              const form = $scope.values.form || {};
              return form["Managers Sign Off"] === "1";
            };

            $scope.onToggleInstance = function (data, $event) {
              if ($event && $event.stopPropagation) $event.stopPropagation();
              data.expanded = !data.expanded;
            
              $scope.values.form = null;
              $scope.values.form_original = null;
              $scope.values.selected_tm1_object = null;
              $scope.values.selected_tm1_object_id = null;
            };

            $scope.toggleTreeNode = function (node, $event) {
              if ($event) $event.stopPropagation();
              node.expanded = !node.expanded;
            };

            $scope.$on('tree:select', function (evt, payload) {
              evt.stopPropagation && evt.stopPropagation();
            
              $scope.values.selected_tm1_object = payload;      
              $scope.values.selected_tm1_object_id = payload.node._id;

              if (!payload.node.info) payload.node.info = {};
              
              $scope.values.form = payload.node.info;
              $scope.values.form_original = angular.copy($scope.values.form);
            
            });

            $scope.onFieldChange = function (fieldKey) {
              const curSel = $scope.values.selected_tm1_object || {};
              const instance = curSel.instance;
              const node = curSel.node;
              const tm1ObjectType = $scope.values.tm1_object_type;
              if (!instance || !node || !tm1ObjectType) return;
            
              const tm1Object = node.tm1_object;
              const cur = $scope.values.form[fieldKey];         
              const old = $scope.values.form_original[fieldKey];
            
              if (cur === old) {
                // update to orginal -> remove from updates 
                const bucket = $scope.values.updates[tm1ObjectType]?.[instance]?.[tm1Object];
                if (bucket && bucket.hasOwnProperty(fieldKey)) {
                  delete bucket[fieldKey];
                  cleanupUpdatesBucketIfEmpty(tm1ObjectType, instance, tm1Object);
                }
              } else {
                ensureUpdatesMetaWithOriginal(tm1ObjectType, instance, tm1Object, $scope.values.form_original);
                // new update -> add to updates
                const bucket = ensureUpdatesBucket(tm1ObjectType, instance, tm1Object);
                bucket[fieldKey] = cur;
              }
              node.info[fieldKey] = cur;
            };

            $scope.hasUpdates = function () {
              return Object.keys($scope.values.updates).length > 0;
            };

            $scope.onSaveAll = async function () {
              if (!$scope.hasUpdates()) return;
            
              $scope.values.loading = true;
            
              try {
                const body = buildUpdatePayloadsFromUpdates();
                if (!body.length) {
                  return;
                }
            
                const url = "/Cubes('" + CUBE_NAME + "')/tm1.Update";
            
                // write back
                await $tm1.async(FIXED_INSTANCE, "POST", url, body);
            
                // reload tree
                await $scope.loadInstanceObjectTree();
            
                $scope.values.updates = {};
                $scope.values.updates_meta = {};
            
                if ($scope.values.selected_tm1_object &&
                    $scope.values.selected_tm1_object.node &&
                    $scope.values.selected_tm1_object.node.info) {
                  $scope.values.form_original = angular.copy($scope.values.form);
                  $scope.values.selected_tm1_object.node.info = angular.copy($scope.values.form);
                }
            
              } catch (err) {
                console.log('onSaveAll error: ', err)
              } finally {
                $scope.values.loading = false;
                $scope.$applyAsync();
              }
            };

            $scope.onDiscardAll = function () {
              Object.keys($scope.values.updates_meta).forEach(uiType => {
                const perUI = $scope.values.updates_meta[uiType] || {};
            
                Object.keys(perUI).forEach(inst => {
                  const perInst = perUI[inst] || {};
            
                  Object.keys(perInst).forEach(obj => {
                    const original = perInst[obj]?.original || {};
                    const node = findNodeByInstanceAndObject(inst, obj);
            
                    if (node) {
                      node.info = angular.copy(original);
                    }
            
                    const isCurrent =
                      $scope.values.selected_tm1_object &&
                      $scope.values.selected_tm1_object.instance === inst &&
                      $scope.values.selected_tm1_object.node &&
                      $scope.values.selected_tm1_object.node.tm1_object === obj;
            
                    if (isCurrent) {
                      $scope.values.form = angular.copy(original);
                      $scope.values.form_original = angular.copy(original);
                      $scope.values.selected_tm1_object.node.info = $scope.values.form;
                    }
                  });
                });
              });
            
              $scope.values.updates = {};
              $scope.values.updates_meta = {};
            };

            $scope.onManagerSignOff = async function () {
              if ($scope.isFormReadOnly()) return;
              const fieldKey = "Managers Sign Off"
              $scope.values.form[fieldKey] = "1";
              $scope.onFieldChange(fieldKey)
              await $scope.onSaveAll()
            };

            $scope.onManagerReopen = async function () {
              if (!$scope.isFormReadOnly()) return;
              const fieldKey = "Managers Sign Off"
              $scope.values.form[fieldKey] = "";
              $scope.onFieldChange(fieldKey)
              await $scope.onSaveAll()
            };

            //Trigger an event after the login screen
            $scope.$on("login-reload", function (event, args) {

            });

            //Close the tab
            $scope.$on("close-tab", function (event, args) {
                // Event to capture when a user has clicked close on the tab
                if (args.page == "arcTemplate" && args.instance == $scope.instance && args.name == null) {
                    // The page matches this one so close it
                    $rootScope.close(args.page, { instance: $scope.instance });
                }
            });

            //Trigger an event after the plugin closes
            $scope.$on("$destroy", function (event) {

            });
        }]
    };
});

arc.directive("treeNode", function ($compile) {
  return {
    restrict: "E",
    scope: {
      node: "=",
      instance: "=",
      selectedId: "=",
      isLoading: "=" 
    },
    template: `
      <li 
        class="tree-node" 
        ng-class="{
          'is-selected': selectedId === node._id, 
          'disabled': isLoading
        }"
      >
        <div 
          class="tree-row"
          ng-click="onRowClick(node, $event)"
        >
          <div 
            class="caret-box"
            ng-class="{'hidden': isLeaf(node)}"
          >
            <i class="caret" ng-class="{'open': node.expanded}"></i>
          </div>
          <span 
            class="tree-label"
            title="{{ node.tm1_object }}"
          >
            {{node.tm1_object}}
          </span>
          <div 
            class="status-light" 
            ng-class="statusClass(node.info.Status)"
            ng-if="node.info"
          ></div>
        </div>
      </li>
    `,
    link: function (scope, element) {
      if (angular.isArray(scope.node.nodes) && scope.node.nodes.length) {
        const tpl = `
          <ul class="tree-children" ng-if="node.expanded">
            <tree-node
              ng-repeat="c in node.nodes track by c._id"
              node="c"
              instance="instance"
              selected-id="selectedId"
              is-loading="isLoading"
            >
            </tree-node>
          </ul>`;
        element.append($compile(tpl)(scope));
      }

      scope.isLeaf = function (node) {
        return !(node.nodes && node.nodes.length > 0);
      };

      scope.onRowClick = function (node, $event) {
        if (scope.isLoading) {
          return;
        }
        $event.stopPropagation();

        if (!scope.isLeaf(node)) {
          node.expanded = !node.expanded;
          return;
        }

        scope.$emit('tree:select', { instance: scope.instance, node: node });
      };

      scope.statusClass = function (status) {
        if (!status) return 'st-not-start';
        
        switch (status) {
          case 'Not Start':
            return 'st-not-start';
          case 'Start':
            return 'st-start';
          case 'Partial Finished':
            return 'st-partial';
          case 'Finished':
            return 'st-finished';
          default:
            return 'st-not-start';
        }
      };
    }
  };
});

arc.directive("kbMultiSelect", ["$document", "$rootScope", "$timeout", function ($document, $rootScope, $timeout) {
  var nextId = 1;

  return {
    restrict: "E",
    scope: {
      label: "@",
      fieldKey: "@",
      options: "=",
      form: "=",
      disabled: "=",
      onChange: "&"
    },
    template: `
      <div 
        class="field-wrap flex-column"
        ng-class="{'disabled': disabled}"
      >
        <label class="field-label">{{label}}</label>

        <div class="select-box select-box--multi" ng-click="toggleOpen($event)">
          <div class="kb-tag-list">
            <span 
              class="kb-tag"
              ng-repeat="v in selectedList track by v"
            >
              {{v}}
              <span 
                class="kb-tag-close"
                ng-click="$event.stopPropagation(); remove(v)"
                ng-if="!disabled"
              >x</span>
            </span>
          </div>

          <i class="fa fa-chevron-down kb-select-icon" aria-hidden="true"></i>
        
          <div 
            class="kb-multi-menu kb-multi-menu--bottom"
            ng-show="menuOpen"
          >
            <div 
              class="kb-multi-item"
              ng-repeat="o in options track by o.Name"
            >
              <input 
                type="checkbox"
                ng-checked="isChecked(o.Name)"
                ng-click="toggle(o.Name, $event)"
              />
              <span ng-click="toggle(o.Name, $event)">{{o.Name}}</span>
            </div>
          </div>
        </div>
      </div>
    `,
    link: function (scope, element) {
      var myId = nextId++;

      function splitMulti(str) {
        if (!str) return [];
        return String(str)
          .split("|")
          .map(function (s) { return s.trim(); })
          .filter(function (s) { return s.length > 0; });
      }

      function joinMulti(arr) {
        if (!arr || !arr.length) return "";
        return arr.join("|");
      }

      function syncFromForm() {
        if (!scope.form) {
          scope.selectedList = [];
          return;
        }
        var raw = scope.form[scope.fieldKey];
        scope.selectedList = splitMulti(raw);
      }

      scope.selectedList = [];
      scope.menuOpen = false;

      scope.$watch(
        function () {
          return scope.form && scope.form[scope.fieldKey];
        },
        function () {
          syncFromForm();
        }
      );

      function updateMenuPosition() {
        var menuEl = element[0].querySelector(".kb-multi-menu");
        var boxEl = element[0].querySelector(".select-box--multi");
        if (!menuEl || !boxEl) return;

        menuEl.classList.remove("kb-multi-menu--top", "kb-multi-menu--bottom");

        var rect = boxEl.getBoundingClientRect();
        var ESTIMATED_MENU_HEIGHT = 220;
        var spaceBelow = window.innerHeight - rect.bottom;
        var spaceAbove = rect.top;

        if (spaceBelow < ESTIMATED_MENU_HEIGHT && spaceAbove > spaceBelow) {
          menuEl.classList.add("kb-multi-menu--top");
        } else {
          menuEl.classList.add("kb-multi-menu--bottom");
        }
      }

      scope.toggleOpen = function ($event) {
        if (scope.disabled) return;
        if ($event) $event.stopPropagation();

        var willOpen = !scope.menuOpen;
        scope.menuOpen = willOpen;

        if (willOpen) {
          $rootScope.$broadcast("kbMultiSelect:open", myId);
          $timeout(updateMenuPosition, 0);
        }
      };

      scope.$on("kbMultiSelect:open", function (evt, openedId) {
        if (openedId !== myId && scope.menuOpen) {
          scope.$applyAsync(function () {
            scope.menuOpen = false;
          });
        }
      });

      function onDocClick(e) {
        if (!scope.menuOpen) return;
        if (element[0].contains(e.target)) return;

        scope.$applyAsync(function () {
          scope.menuOpen = false;
        });
      }

      $document.on("click", onDocClick);

      scope.$on("$destroy", function () {
        $document.off("click", onDocClick);
      });

      scope.isChecked = function (name) {
        return scope.selectedList.indexOf(name) !== -1;
      };

      scope.toggle = function (name, $event) {
        if ($event) $event.stopPropagation();
        if (scope.disabled) return;

        var idx = scope.selectedList.indexOf(name);
        if (idx === -1) {
          scope.selectedList.push(name);
        } else {
          scope.selectedList.splice(idx, 1);
        }
        updateForm();
      };

      scope.remove = function (name) {
        if (scope.disabled) return;

        var idx = scope.selectedList.indexOf(name);
        if (idx >= 0) {
          scope.selectedList.splice(idx, 1);
          updateForm();
        }
      };

      function updateForm() {
        if (!scope.form) return;
        scope.form[scope.fieldKey] = joinMulti(scope.selectedList);
        if (scope.onChange) {
          scope.onChange({ fieldKey: scope.fieldKey });
        }
      }
    }
  };
}]);



