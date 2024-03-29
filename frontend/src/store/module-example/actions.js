import axios from 'axios'
import { omitColumnsColumnSettings, messages } from 'src/utils.js'

export function resolveSesameQuery(ctx) {
  console.log('Query Resolving....', ctx.state.queryString)
  ctx.commit('setSesameStatus', 'resolving')
  ctx.commit(
    'setSesameMessage',
    'Trying to resolve query as an object name in Sesame CDS Service.'
  )
  ctx.commit('addRowStream', {
    msg: `Trying to resolve query "${ctx.state.queryString}" as an object name in Sesame CDS Service.`,
    status: 'resolving',
  })

  // dirty hack to avoid Sesame error
  const queryClean = ctx.state.queryString.replace('+', '%2b')
  const ucds = `https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SVN?${queryClean}`

  axios
    .get(ucds)
    .then((response) => response.data)
    .then((str) => new window.DOMParser().parseFromString(str, 'text/xml'))
    .then((data) => {
      const e_ra = data.getElementsByTagName('jradeg')[0]
      const e_de = data.getElementsByTagName('jdedeg')[0]

      if (e_ra !== undefined && e_de !== undefined) {
        const numRa = Number(e_ra.textContent)
        const numDec = Number(e_de.textContent)
        const coneQuery = `cone(${numRa}, ${numDec}, 0.015)`

        // informational output
        ctx.commit('setSesameStatus', 'resolved')
        ctx.commit(
          'setSesameMessage',
          `Sesame CDS Service successfully resolved ${queryClean} as coordinates: ${numRa}, ${numDec}.`
        )
        ctx.commit('addRowStream', {
          msg: `Sesame CDS Service successfully resolved ${queryClean} as coordinates: ${numRa}, ${numDec}.`,
          status: 'resolved',
        })
        ctx.commit('setQueryString', coneQuery)
        console.log('Sesame successfully resolved query')
        console.log(e_ra.textContent, e_de.textContent)
        console.log(coneQuery)
        // repeat data fetchiing with cone syntaxes
        ctx.dispatch('fetchTable')
      } else {
        console.log('Sesame cannot resolve name query!!!')
        ctx.commit('setSesameStatus', 'unresolved')
        ctx.commit(
          'setSesameMessage',
          `Sesame CDS Service cannot resolve ${queryClean} as object name. Try to re-write query.`
        )
        ctx.commit('addRowStream', {
          msg: `Sesame CDS Service cannot resolve ${queryClean} as object name. Try to re-write query.`,
          status: 'unresolved',
        })
      }
    })
    .catch((error) => {
      console.log('Some problem with request to the Sesame Service at CDS!')
      console.error(error)
      ctx.commit('setSesameStatus', 'error')
      ctx.commit(
        'setSesameMessage',
        'There was some problem with request to the Sesame CDS Name resolver!'
      )
      ctx.commit('addRowStream', {
        msg: 'There was some problem with request to the Sesame CDS Name resolver!',
        status: 'error',
      })
    })
}

export function fetchTable(ctx) {
  ctx.commit('setTableStatus', 'loading')
  ctx.commit('setTableMessage', 'Retrieving data from API...')
  ctx.commit('addRowStream', {
    msg: `Retrieving data from API with "${ctx.state.queryString}" query string.`,
    status: 'loading',
  })

  const queryClean = ctx.state.queryString.replace('+', '%2b')

  const p = ctx.state.tablePagination
  const tableColumnsTicked = ctx.state.tableColumnsTicked
  const tableColumnsTickedStr = tableColumnsTicked
    .map((e) => e.replace('lotss.', ''))
    .join()

  const url = `${process.env.URL_API}/lotss/?expand=~all&fields=${tableColumnsTickedStr}&q=${queryClean}&page=${p.page}&page_size=${p.rowsPerPage}&sortby=${p.sortBy}&descending=${p.descending}`
  console.log('Requesting: ', url)
  axios
    .get(url)
    .then(({ data }) => {
      // First, expecting that query is param-search
      const results = data.results

      const results_upd = results.reduce((res, row) => {
        const entries = tableColumnsTicked.map((column) => {
          const [table, field] = column.split('.')
          const key = table == 'lotss' ? field : column

          const value =
            table == 'lotss'
              ? row[key]
              : row[table] != null
              ? row[table][field]
              : null

          // const nSubRows = table == 'lotss' ? 1 : row[table]?.length
          const nElementsInColumn =
            table == 'lotss' ? 1 : row[table] != null ? row[table].length : null

          return [key, value]
        })

        res.push(Object.fromEntries(entries))
        // res.push(Object.fromEntries(entries))
        return res
      }, [])

      ctx.commit('setTableData', { ...data, results: results_upd })

      ctx.commit('setTablePagination', {
        ...ctx.state.tablePagination,
        rowsNumber: data.count,
      })

      ctx.commit('setTableStatus', 'loaded')
      ctx.commit('setTableMessage', `${data.count} sources found`)
      ctx.commit('addRowStream', {
        msg: `${data.count} sources found`,
        status: 'loaded',
      })
    })
    .catch((error) => {
      // If does not work, try resolve query as Sesame
      console.error(`Something went wrong ${error}`)
      ctx.commit('setTableStatus', 'error')
      ctx.commit(
        'setTableMessage',
        `Something went wrong while loading the data: ${error}`
      )
      ctx.commit('addRowStream', {
        msg: `Something went wrong while loading the data: ${error}`,
        status: 'error',
      })
      ctx.dispatch('resolveSesameQuery')
    })
}

function parseSchema(schema) {
  const d = schema.definitions
  const tableObj = d
    ? Object.keys(d).map((key) => {
        const prop = d[key].properties
        return {
          label: d[key].table_name,
          key: d[key].table_name,
          description: d[key].description,
          children: Object.keys(prop)
            .filter((p) => !omitColumnsColumnSettings.includes(p))
            .map((p) => {
              return {
                label: p,
                key: `${d[key].table_name}.${p}`,
                description: prop[p].description,
              }
            }),
        }
      })
    : null
  return tableObj
}

export function loadSchema(ctx) {
  const schemaURL = `${process.env.URL_API}/swagger.json`
  axios
    .get(schemaURL)
    .then(({ data }) => {
      ctx.commit('setSchema', data)

      const tableObj = parseSchema(data)
      console.log('Schema loaded (tableColumnsObject):', { tableObj })
      ctx.commit('setTableColumnsObject', tableObj)

      const columnDescription = [
        ...tableObj[0].children,
        ...tableObj[1].children,
      ].reduce((res, value) => ({
        ...res,
        [value.key]: value.description,
      }))

      console.log('Created column description:', { columnDescription })
      ctx.commit('setTableColumnsDescription', columnDescription)
    })
    .catch((error) => {
      console.error(error)
    })
}
